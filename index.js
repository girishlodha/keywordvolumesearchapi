require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const MongoClient = require('mongodb').MongoClient;
const corsOptions = {
    origin:"*"
};
const PORT = process.env.PORT || 5000;
const app = express();
const apiKey = process.env.KEYSTRING;
const uri = process.env.URI;
let client; // Declare client at the top-level scope
app.use(cors(corsOptions))

async function connectToMongo() {
    if (!client) {
        client = new MongoClient(uri);
        await client.connect();
    }
}

function extractWords(title) {
    return title.match(/\b\w+\b/g) || [];
}

app.use(express.json());

app.get('/api/data', async (req, res) => {
    try {
        await connectToMongo(); // Ensure connection before proceeding

        const limit = 100; // Maximum limit per request
        let offset = 0;
        const database = client.db('KeywordSearch');
        const collection = database.collection('titleandviews');

        while (true) {
            const response = await axios.get('https://openapi.etsy.com/v3/application/listings/active', {
                headers: {
                    'x-api-key': apiKey,
                },
                params: {
                    limit,
                    offset,
                    sort_on: 'created',
                    sort_order: 'desc',
                },
            });

            const fetchedListings = response.data.results;

            // Filter out listings with the same title that already exist in MongoDB
            const existingTitles = await getExistingTitles();

            for (const item of fetchedListings) {
                if (existingTitles.includes(item.title)) {
                    // If the title already exists, check if views are different
                    const existingItem = await collection.findOne({ title: item.title });

                    if (existingItem && existingItem.views !== item.views) {
                        // Remove the existing title with different views
                        await collection.deleteOne({ title: item.title });

                        // Insert the new item with updated views
                        await collection.insertOne({
                            title: item.title,
                            views: item.views
                        });
                    }
                } else {
                    // Insert each unique item into MongoDB
                    await collection.insertOne({
                        title: item.title,
                        views: item.views
                    });
                }
            }

            // Break the loop if there are no more unique listings (or adjust condition as needed)
            console.log(offset);
            if (offset > 5000) {
                break;
            }

            offset++;
        }

        // Close MongoDB connection
        await client.close();

        res.json({ success: true });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


async function getExistingTitles() {
    const database = client.db('KeywordSearch');
    const collection = database.collection('titleandviews');
    const existingTitles = await collection.distinct('title');
    return existingTitles;
}

app.get('/api/mongo-data', async (req, res) => {
    try {
        await connectToMongo(); // Ensure connection before proceeding

        const database = client.db('KeywordSearch');
        const collection = database.collection('titleandviews');
        const data = await collection.find().toArray();

        // Store the array of views for each word in 'wordViewsArray' collection
        const wordViewsArray = database.collection('wordViewsArray');
        const wordMedianArray = database.collection('wordMedianArray');



        const result = {};

        data.forEach(item => {
            console.log(item.title, item._id);
            const words = extractWords(item.title);

            words.forEach(word => {
                if (!result[word]) {
                    result[word] = [];
                }

                result[word].push(item.views);
            });
        });

        const wordViewsData = Object.entries(result).map(([word, viewsArray]) => ({
            word,
            viewsArray,
            median: calculateMedian(viewsArray),
        }));

        // Insert word views data into 'wordViewsArray' collection
        //await wordViewsArray.insertMany(wordViewsData);
        await wordMedianArray.deleteMany({});
        // Insert word views data into 'wordMedianArray' collection
        await wordMedianArray.insertMany(wordViewsData);
        console.log(wordViewsData)
        res.json(data);
    } catch (error) {
        console.error('Error fetching MongoDB data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

function calculateMedian(array) {
    const sortedArray = array.sort((a, b) => a - b);
    const middle = Math.floor(sortedArray.length / 2);

    if (sortedArray.length % 2 === 0) {
        return Math.floor((sortedArray[middle - 1] + sortedArray[middle]) / 2);
    } else {
        return sortedArray[middle];
    }
}
app.get('/api/calculate-median/:word', async (req, res) => {
    try {
        const word = req.params.word;
        await connectToMongo();

        const database = client.db('KeywordSearch');
        const collection = database.collection('wordMedianArray');

        const result = await collection.findOne({ word });

        if (!result) {
            return res.status(404).json({ error: 'Word not found' });
        }

        res.json({ median: result.median });
    } catch (error) {
        console.error('Error calculating median:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Close MongoDB connection when the server is stopped
process.on('SIGINT', async () => {
    await client.close();
    process.exit();
});

app.listen(PORT, () => {
    console.log(`Server is running on port 5000`);
});

module.exports = app;