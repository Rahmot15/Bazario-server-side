require('dotenv').config()
const express = require('express')
const cors = require('cors');

const admin = require("firebase-admin");
const serviceAccount = require("./bazario-auth-firebase-adminsdk.json");


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const port = process.env.PORT || 5000

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

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
        const reviewsCollection = db.collection("reviews")
        const usersCollection = db.collection('users')
        const adsCollection = db.collection('ads')
        const paymentsCollection = db.collection('payments')
        const watchlistCollection = db.collection('watchList')

        app.get('/products', async (req, res) => {
            const result = await productsCollections.find().toArray()
            res.send(result)
        })

        // limit operator and approved Product
        app.get('/products/approved', async (req, res) => {
            const limit = parseInt(req.query.limit) || 6;

            const result = await productsCollections
                .find({ status: "approved" })
                .sort({ "historicalPrices.date": -1 })
                .limit(limit)
                .toArray();

            res.send(result);
        });


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

        // Approve or change status route
        app.patch('/products/status/:id', verifyFirebaseToken, async (req, res) => {
            const productId = req.params.id;
            const { status } = req.body;

            if (!['approved', 'rejected', 'pending'].includes(status)) {
                return res.status(400).send({ message: 'Invalid status' });
            }

            const filter = { _id: new ObjectId(productId) };
            const updateDoc = { $set: { status } };

            const productUpdateResult = await productsCollections.updateOne(filter, updateDoc);

            if (status === "approved") {
                const product = await productsCollections.findOne(filter);
                if (product?.vendorEmail) {
                    await usersCollection.updateOne(
                        { email: product.vendorEmail },
                        { $set: { sellerStatus: "approved" } }
                    );
                }
            }

            res.send(productUpdateResult);
        });

        // Reject route with feedback
        app.patch("/products/reject/:id", async (req, res) => {
            const { id } = req.params;
            const { feedback, status } = req.body;

            const result = await productsCollections.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        status: status || "rejected",
                        rejectionFeedback: feedback,
                    },
                }
            );

            res.send(result);
        });




        // seller email dia product dakha
        app.get('/VendorsProducts', verifyFirebaseToken, async (req, res) => {
            const email = req.query.email;
            const query = email ? { vendorEmail: email } : {};
            const result = await productsCollections.find(query).toArray();
            res.send(result);
        });

        // Get reviews for a product
        app.get("/reviews/:productId", async (req, res) => {
            const productId = req.params.productId;
            const result = await reviewsCollection
                .find({ productId })
                .sort({ date: -1 })
                .toArray();
            res.send(result);
        });


        // save or update a users info in db
        app.post('/user', async (req, res) => {
            const userData = req.body
            userData.role = 'customer'
            userData.created_at = new Date().toISOString()
            userData.last_loggedIn = new Date().toISOString()
            const query = {
                email: userData?.email,
            }
            const alreadyExists = await usersCollection.findOne(query)
            console.log('User already exists: ', !!alreadyExists)
            if (!!alreadyExists) {
                console.log('Updating user data......')
                const result = await usersCollection.updateOne(query, {
                    $set: { last_loggedIn: new Date().toISOString() },
                })
                return res.send(result)
            }

            console.log('Creating user data......')
            // return console.log(userData)
            const result = await usersCollection.insertOne(userData)
            res.send(result)
        })

        // get a user's role
        app.get('/user/role/:email', async (req, res) => {
            const email = req.params.email
            const result = await usersCollection.findOne({ email })
            if (!result) return res.status(404).send({ message: 'User Not Found.' })
            res.send({ role: result?.role })
        })

        // get all users for admin
        app.get('/all-users', verifyFirebaseToken, async (req, res) => {
            const filter = {
                email: {
                    $ne: req?.decoded?.email,
                },
            }
            const result = await usersCollection.find(filter).toArray()
            res.send(result)
        })

        // update a user's role
        app.patch('/user/role/update/:email', verifyFirebaseToken, async (req, res) => {
            const email = req.params.email
            const { role } = req.body
            console.log(role)
            const filter = { email: email }
            const updateDoc = {
                $set: {
                    role

                },
            }
            const result = await usersCollection.updateOne(filter, updateDoc)
            console.log(result)
            res.send(result)
        })



        // Post a review
        app.post("/reviews", async (req, res) => {
            const review = req.body;
            if (!review.productId || !review.userEmail || !review.comment || !review.rating) {
                return res.status(400).send({ error: "Missing fields" });
            }

            const existing = await reviewsCollection.findOne({
                productId: review.productId,
                userEmail: review.userEmail,
            });
            if (existing) {
                return res.status(409).send({ error: "You already reviewed this product" });
            }

            review.date = new Date().toISOString().split("T")[0];
            const result = await reviewsCollection.insertOne(review);
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



        // Seller add-advertisements
        app.post('/add-advertisements', async (req, res) => {
            const product = req.body;
            try {
                const result = await adsCollection.insertOne(product);
                res.send(result);
            } catch (error) {
                console.error("Failed to insert advertisement:", error);
                res.status(500).send({ message: "Failed to add advertisement" });
            }
        });

        // Seller get add-advertisements
        app.get('/advertisements', async (req, res) => {
            try {
                const result = await adsCollection.find().toArray();
                res.send(result);
            } catch (error) {
                console.error("Failed to fetch advertisements:", error);
                res.status(500).send({ message: "Failed to fetch advertisements" });
            }
        });

        // Seller get one advertisements
        app.get('/advertisements/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const query = { _id: new ObjectId(id) };
                const ads = await adsCollection.findOne(query);

                if (ads) {
                    res.send(ads);
                } else {
                    res.status(404).send({ message: 'Product not found' });
                }
            } catch (error) {
                res.status(500).send({ message: 'Invalid ID or Server Error' });
            }
        });

        // Seller Update advertisements
        app.patch("/advertisements/:id", async (req, res) => {
            const { id } = req.params;
            const updatedData = req.body;

            try {
                const result = await adsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );

                if (result.modifiedCount > 0) {
                    res.send({ success: true, message: "Status updated successfully" });
                } else {
                    res.status(404).send({ success: false, message: "Ad not found or already has the same status" });
                }
            } catch (error) {
                console.error("Error updating status:", error);
                res.status(500).send({ success: false, message: "Internal Server Error" });
            }
        });


        // Seller delete advertisements
        app.delete('/advertisements/:id', async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ error: 'Invalid product ID' });
            }

            const result = await adsCollection.deleteOne({ _id: new ObjectId(id) });

            if (result.deletedCount === 1) {
                res.send({ message: 'Product deleted successfully' });
            } else {
                res.status(404).send({ error: 'Product not found' });
            }
        });



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



        // Stripe payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const amountInCents = req.body.amountInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });
                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });


        // Get payment history by user email (descending)
        app.get("/payments", verifyFirebaseToken, async (req, res) => {
            try {
                const email = 'habib23445676896789@gmail.com';

                console.log("decoded", req.decoded);
                if (req.decoded.email !== email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }

                const query = email ? { paidBy: email } : {};

                const payments = await paymentsCollection
                    .find(query)
                    .sort({ date: -1 }) // latest first
                    .toArray();

                res.send(payments);
            } catch (error) {
                console.error("Error fetching payment history:", error);
                res.status(500).send({ message: "Failed to fetch payments", error: error.message });
            }
        });


        // Get all payment history
        app.get("/allPayments", async (req, res) => {
            try {
                const result = await paymentsCollection
                    .find()
                    .sort({ date: -1 }) // latest payments first
                    .toArray();

                res.send(result);
            } catch (error) {
                console.error("Error fetching payments:", error);
                res.status(500).send({ message: "Failed to fetch payments", error: error.message });
            }
        });


        //  Mark a parcel as paid + Save payment history
        app.post("/payments", async (req, res) => {
            try {
                const { parcelId, transactionId, todayPrice, paidBy, marketName, productName } = req.body;

                // Update parcel payment_status
                const updateResult = await productsCollections.updateOne(
                    { _id: new ObjectId(parcelId) },
                    { $set: { payment_status: "paid" } }
                );

                // Insert payment history
                const paymentEntry = {
                    parcelId: new ObjectId(parcelId),
                    transactionId,
                    todayPrice,
                    productName,
                    marketName,
                    paidBy,
                    date: new Date().toISOString(),
                };

                const insertResult = await paymentsCollection.insertOne(paymentEntry);

                res.send({
                    message: "Payment recorded successfully",
                    parcelUpdate: updateResult,
                    insertedId: insertResult.insertedId,
                });
            } catch (error) {
                console.error("Error saving payment:", error);
                res.status(500).send({ message: "Failed to record payment", error: error.message });
            }
        });


        // Product watchList add
        app.post("/watchlist", async (req, res) => {
            const { productName, marketName, date, userEmail } = req.body;
            const result = await watchlistCollection.insertOne({
                productName,
                marketName,
                date,
                userEmail,
                addedAt: new Date(),
            });
            res.send(result);
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
