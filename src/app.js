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
module.exports = app;
