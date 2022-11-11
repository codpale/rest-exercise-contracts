const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model');
const { Op } = require('sequelize');
const { getProfile } = require('./middleware/getProfile');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

/**
 * Point 1
 * FIXED
 *
 * Returns the data about the requested contract. It returns data
 * only if the requested contract belong to the profile who made
 * the request.
 *
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
  const { Contract } = req.app.get('models');
  const { id } = req.params;
  const contract = await Contract.findOne({ where: { id } });
  if (!contract) return res.status(404).end();
  // Point 1
  // authorization check: the requested contract id must matches the profile_id of the HTTP header
  if (req.profile.id !== contract.id) {
    res.status(403).end();
    return;
  }
  res.json(contract);
});

/**
 * Point 2
 *
 * GET /contracts
 *
 * Returns a list of contracts belonging to a user (client or contractor): the list
 * contains only non terminated contracts.
 *
 * @returns active contracts of a user profile
 */
app.get('/contracts', getProfile, async (req, res) => {
  res.json(await getAllActiveContracts(req));
});

/**
 * Gets a list of active contracts belonging to a user
 * (client or contractor) from the database.
 *
 * @returns active contracts of a user profile
 */
async function getAllActiveContracts(req) {
  const { Contract } = req.app.get('models');
  const id = req.profile.id;
  const contracts = await Contract.findAll({
    where: {
      [Op.and]: [
        { [Op.or]: [{ ContractorId: id }, { ClientId: id }] },
        { status: { [Op.ne]: 'terminated' } },
      ],
    },
  });
  return contracts;
}

/**
 * Point 3
 *
 * GET /jobs/unpaid
 *
 * Returns all unpaid jobs for a user (either a client or contractor), for active contracts only.
 *
 * @returns unpaid jobs of a user
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
  const { Contract, Job } = req.app.get('models');
  const id = req.profile.id;
  // get all active contracts of the user
  const contracts = await getAllActiveContracts(req);
  // construct the list of active contract ids of the user
  const contractIds = contracts.map((el) => el.id);
  // get all unpaid jobs of all user's contracts
  const unpaidJobs = await Job.findAll({
    where: {
      [Op.and]: [
        { Paid: { [Op.is]: null } },
        { ContractId: { [Op.in]: contractIds } },
      ],
    },
  });
  res.json(unpaidJobs);
});

/**
 * Point 4
 *
 * POST /jobs/:job_id/pay
 *
 * Pay for a job, a client can only pay if his balance >= the amount to pay.
 * The amount should be moved from the client's balance to the contractor balance.
 *
 * NOTE 1: since a requirement is "make sure only users that are on the contract can
 * access their contracts", the function allows only the owner of a job to pay it.
 *
 * IMPORTANT NOTE!!!
 * It is needed to use a specific library to manage financial calculation, such as Dinero.js.
 * This is because native javascript numbers are not suitable for monetary applications.
 * Some articles on that:
 * - https://blog.logrocket.com/store-retrieve-precise-monetary-values-javascript-dinero-js/
 * - https://www.honeybadger.io/blog/currency-money-calculations-in-javascript/
 *
 * @returns the status code of the operation
 */
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
  const { Profile, Contract, Job } = req.app.get('models');
  const clientId = req.profile.id;
  const jobId = req.params.job_id;

  // get contract id from the job id
  const jobToPay = await Job.findOne({
    where: { id: jobId },
  });
  if (!jobToPay) {
    return res.status(404).end();
  } else if (jobToPay.paid) {
    return res.status(409).send({ error: 'job already paid' }).end();
  }

  // get the contract associated to the job
  // NOTE 2: a job is always associated with a contract: contract cannot be null
  const contractId = jobToPay.ContractId;
  const contract = await Contract.findOne({ where: { id: contractId } });

  // check the authorization: see NOTE 1 above
  if (contract.ClientId !== clientId) {
    return res.status(403).end();
  }

  // get data about the client and contractor profiles
  const clientProfile = await Profile.findOne({ where: { id: clientId } });
  const contractorProfile = await Profile.findOne({
    where: { id: contract.ContractorId },
  });

  // check if the balance of the client profile is >= to the price to be paid
  if (clientProfile.balance < jobToPay.price) {
    return res.status(409).send({ error: 'not enough user balance' }).end();
  }

  // start a transaction to transfer money from client to contractor balance
  // and update the status of the job as paid
  try {
    const result = await sequelize.transaction(async (t) => {
      // update the balance of the client
      const client = await Profile.update(
        { balance: (clientProfile.balance - jobToPay.price).toFixed(2) },
        { where: { id: clientId } },
        { transaction: t }
      );

      // update the balance of the contractor
      const contractor = await Profile.update(
        { balance: (contractorProfile.balance + jobToPay.price).toFixed(2) },
        { where: { id: contract.ContractorId } },
        { transaction: t }
      );

      // update the job as paid
      const job = await Job.update(
        { paid: 1 },
        { where: { id: jobId } },
        { transaction: t }
      );

      return {
        client: client,
        contractor: contractor,
        job: job,
      };
    });
    res.status(200).end();
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
});

/**
 * Point 5
 *
 * POST /balances/deposit/:userId
 *
 * Deposits money into the balance of a client, a client can't deposit
 * more than 25% his total of jobs to pay. (at the deposit moment)
 *
 * ASSUMPTION 1: only a client can use this API as from the rquirements
 * ASSUMPTION 2: the deposit can be made only by the client owner
 * ASSUMPTION 3: the amuont to be deposited is inside the body as a JSON
 *               object: e.g. { "amount": 123.4 } the key is a string
 *               and the amount is a number
 *
 * @returns the status code of the operation
 */
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
  const { Profile, Job } = req.app.get('models');
  const id = req.profile.id;
  const userId = parseInt(req.params.userId);
  const amount = req.body.amount;
  // check if the requester client is the owner of the deposit
  if (id !== userId) {
    return res.status(403).end();
  }
  // check if the user is a client
  const userProfile = await Profile.findOne({ where: { id: userId } });
  if (userProfile.type !== 'client') {
    return res.status(403).end();
  }
  // get the total sum of all unpaid jobs of the client
  const contracts = await getAllActiveContracts(req);
  const contractIds = contracts.map((el) => el.id);
  const totalRes = await Job.findAll({
    where: {
      [Op.and]: [
        { Paid: { [Op.is]: null } },
        { ContractId: { [Op.in]: contractIds } },
      ],
    },
    attributes: [[sequelize.fn('sum', sequelize.col('price')), 'total']],
  });
  let total = 0;
  if (totalRes.length > 0) {
    total = totalRes[0].dataValues.total;
  }
  // check if the amount to be deposit is <= to the 25% of the total unpaid
  if (amount > (total / 100) * 25) {
    return res
      .status(403)
      .send({
        error: 'deposit is greater than 25% of total unpaid: not allowed',
      })
      .end();
  }
  // deposit the amount
  await Profile.update(
    { balance: (userProfile.balance + amount).toFixed(2) },
    { where: { id: userId } }
  );
  res.status(200).end();
});

/**
 * Point 6
 *
 * GET /admin/best-profession?start=<date>&end=<date>
 *
 * Returns the profession that earned the most money (sum of jobs paid) for
 * any contactor that worked in the query time range.
 *
 * NOTE: add the validation of the dates format
 * IMPROVEMENT-1: it can be improved splitting the code in sub-function for
 *                 better readability
 *
 * @returns the profession that earned the most mone
 */
app.get('/admin/best-profession', getProfile, async (req, res) => {
  const startDate = req.query.start;
  const endDate = req.query.end;
  // get all contractors
  const { Profile, Contract, Job } = req.app.get('models');
  const contractors = await Profile.findAll({
    where: {
      type: 'contractor',
    },
  });

  let contracts;
  let contractIds;
  let contractorId;
  let maxPaidContractorId;
  let sumPaidJobsByContractId;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const el of contractors) {
    contractorId = el.id;
    contracts = await Contract.findAll({
      // for each contractor get all related contracts
      where: {
        ContractorId: contractorId,
      },
    });
    // calculate the sum of all paid jobs in the specified period related
    // to all contracts of the current contractor and extract the contractor
    // id with the maximum amount of paid jobs
    contractIds = contracts.map((el) => el.id);
    sumPaidJobsByContractId = await Job.findOne({
      where: {
        [Op.and]: [
          { Paid: { [Op.not]: null } },
          { ContractId: { [Op.in]: contractIds } },
          {
            paymentDate: {
              [Op.between]: [startDate, endDate],
            },
          },
        ],
      },
      attributes: [[sequelize.fn('sum', sequelize.col('price')), 'total']],
    });
    sumPaidJobsByContractId = sumPaidJobsByContractId.dataValues.total;
    if (maxValue < sumPaidJobsByContractId) {
      maxValue = sumPaidJobsByContractId;
      maxPaidContractorId = contractorId;
    }
  }
  // extract and send the profession of the contractor from the previous step
  for (const contractor of contractors) {
    if (contractor.id === maxPaidContractorId) {
      return res.send({ profession: contractor.profession }).end();
    }
  }
});

/**
 * Point 7
 *
 * GET /admin/best-clients?start=<date>&end=<date>&limit=<integer>
 *
 * Returns the clients the paid the most for jobs in the query time period.
 * limit query parameter should be applied, default limit is 2.
 *
 * NOTE1: start date is included, but the end date is excluded.
 *       It can be improved
 * NOTE2: the results contain also the total amount paid by the client
 *
 * @returns the profession that earned the most mone
 */
app.get('/admin/best-clients', getProfile, async (req, res) => {
  const startDate = req.query.start;
  const endDate = req.query.end;
  const limit = req.query.limit || 2;
  const data = await sequelize.query(
    `SELECT SUM(j.price) as totPaid, p.* FROM
            Profiles p JOIN Contracts c JOIN Jobs j ON
                c.ClientId = p.id AND j.ContractId = c.id
            WHERE type = "client"
                  AND paid IS NOT NULL
                  AND j.paymentDate BETWEEN "${startDate}" AND "${endDate}"

            GROUP by p.id
            ORDER by totPaid desc
            LIMIT ${limit}`
  );
  res.send(data[0]).end();
});

module.exports = app;
