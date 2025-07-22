const express = require('express')
const cors = require('cors');
require('dotenv').config()

const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())




// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        const db = client.db("Bazariodb")
        const productsCollections = db.collection("products")

        app.get('/products', async (req, res) => {

            const result = await productsCollections.find().toArray()
            res.send(result)
        })

        // Seller Product add
        app.post('/add-products', async (req, res) => {
            const product = req.body
            const result = productsCollections.insertOne(product)
            res.send(result)
        })

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {

    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Bazario server is running!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
