const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {Op} = require('sequelize')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

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
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const contract = await Contract.findOne({where: {id}})
    if(!contract) return res.status(404).end()
    // Point 1
    // authorization check: the requested contract id must matches the profile_id of the HTTP header
    if (req.profile.id !== contract.id) {
        res.status(403).end()
        return
    }
    res.json(contract)
})

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
 app.get('/contracts',getProfile ,async (req, res) =>{
    res.json(await getAllActiveContracts(req))
})

/**
 * Gets a list of active contracts belonging to a user
 * (client or contractor) from the database.
 *
 * @returns active contracts of a user profile
 */
async function getAllActiveContracts(req) {
    const {Contract} = req.app.get('models')
    const id = req.profile.id
    const contracts = await Contract.findAll({
        where: {
            [Op.and]: [
                {[Op.or]: [{ContractorId: id}, {ClientId: id}]},
                {status: {[Op.ne]: "terminated"}}
            ]
        }
    })
    return contracts
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
 app.get('/jobs/unpaid',getProfile ,async (req, res) =>{
    const {Contract, Job} = req.app.get('models')
    const id = req.profile.id
    // get all active contracts of the user
    const contracts = await getAllActiveContracts(req)
    // construct the list of active contract ids of the user
    const contractIds = contracts.map(el => el.id)
    // get all unpaid jobs of all user's contracts
    const unpaidJobs = await Job.findAll({
        where: {
            [Op.and]: [
                {Paid: {[Op.is]: null}},
                {ContractId: {[Op.in]: contractIds}}
            ]
        }
    })
    res.json(unpaidJobs)
})

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
 app.post('/jobs/:job_id/pay',getProfile ,async (req, res) =>{
    const { Profile, Contract, Job } = req.app.get('models')
    const clientId = req.profile.id
    const jobId = req.params.job_id

    // get contract id from the job id
    const jobToPay = await Job.findOne({
        where: { id: jobId }
    })
    if (!jobToPay) {
        return res.status(404).end()
    } else if (jobToPay.paid) {
        return res.status(409).send({ "error" : "job already paid" }).end()
    }

    // get the contract associated to the job
    // NOTE 2: a job is always associated with a contract: contract cannot be null
    const contractId = jobToPay.ContractId
    const contract = await Contract.findOne({ where: { id: contractId }})

    // check the authorization: see NOTE 1 above
    if (contract.ClientId !== clientId) {
        return res.status(403).end()
    }

    // get data about the client and contractor profiles
    const clientProfile = await Profile.findOne({ where: { id: clientId }})
    const contractorProfile = await Profile.findOne({ where: { id: contract.ContractorId }})

    // check if the balance of the client profile is >= to the price to be paid
    if (clientProfile.balance < jobToPay.price) {
        return res.status(409).send({ "error" : "not enough user balance" }).end()
    }

    // start a transaction to transfer money from client to contractor balance
    // and update the status of the job as paid
    try {
        const result = await sequelize.transaction(async (t) => {

            // update the balance of the client
            const client = await Profile.update(
                { balance: (clientProfile.balance - jobToPay.price).toFixed(2) },
                { where: { id: clientId }
            }, { transaction: t });

            // update the balance of the contractor
            const contractor = await Profile.update(
                { balance: (contractorProfile.balance + jobToPay.price).toFixed(2) },
                { where: { id: contract.ContractorId }
            }, { transaction: t });

            // update the job as paid
            const job = await Job.update(
                { paid: 1 },
                { where: { id: jobId }
            }, { transaction: t });

            return {
                client: client,
                contractor: contractor,
                job: job
            };
        });
        res.status(200).end()
    } catch (error) {
        console.error(error);
        res.status(500).end()
    }
})

module.exports = app;
