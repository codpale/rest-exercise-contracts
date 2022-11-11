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
    res.json(contracts)
})
module.exports = app;
