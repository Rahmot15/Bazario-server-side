require('dotenv').config()
const express = require('express')
const cors = require('cors');

const admin = require("firebase-admin");
const serviceAccount = require("./bazario-auth-firebase-adminsdk.json");


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())





admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    const token = authHeader.split(' ')[1];
    console.log(token);


    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.decoded = decoded
        next()
    }
    catch {
        return res.status(401).send({ message: 'unauthorized access' })
    }
}


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

        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;

            try {
                const query = { _id: new ObjectId(id) };
                const product = await productsCollections.findOne(query);

                if (product) {
                    res.send(product);
                } else {
                    res.status(404).send({ message: 'Product not found' });
                }
            } catch (error) {
                res.status(500).send({ message: 'Invalid ID or Server Error' });
            }
        });

        // seller email dia product dakha
        app.get('/VendorsProducts', verifyFirebaseToken, async (req, res) => {

            const email = req.query.email;
            const query = email ? { vendorEmail: email } : {};
            const result = await productsCollections.find(query).toArray();
            res.send(result);
        });

        // GET product by ID
        app.get("/products/:id", async (req, res) => {
            const id = req.params.id;
            const result = await productsCollections.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // UPDATE product by ID
        app.put("/products/:id", async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const result = await productsCollections.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            );

            res.send(result);
        });

        // Seller Product add
        app.post('/add-products', async (req, res) => {
            const product = req.body
            const result = productsCollections.insertOne(product)
            res.send(result)
        })

        // seller product delete
        app.delete('/products/:id', async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ error: 'Invalid product ID' });
            }

            const result = await productsCollections.deleteOne({ _id: new ObjectId(id) });

            if (result.deletedCount === 1) {
                res.send({ message: 'Product deleted successfully' });
            } else {
                res.status(404).send({ error: 'Product not found' });
            }
        });




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
