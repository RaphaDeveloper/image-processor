const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const port = 3000;

const storage = multer.memoryStorage();
const upload = multer({ storage });

AWS.config.update({ region: process.env.AWS_REGION });

const s3 = new AWS.S3();
const sqs = new AWS.SQS();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

app.get("/health_check", (req, res) => {
    res.status(200).send();
});

app.post("/upload", upload.single("image"), (req, res) => {
    const id = uuidv4();

    const fileName = `${id}-${req.file.originalname}`;

    const s3Params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ACL: "public-read"
    };

    s3.upload(s3Params, (error, data) => {
        if (error) {
            console.error('Error:', error);
            res.status(500).send('Error processing request.');
        }

        const dynamoDbParams = {
            TableName: process.env.DYNAMODB_TABLE_NAME,
            Item: {
                id,
                fileName: fileName,
                fileUrl: data.Location,
                status: "processing",
                uploadedAt: new Date().toISOString()
            }
        };

        dynamoDb.put(dynamoDbParams, (error) => {
            if (error) {
                console.error('Error:', error);
                res.status(500).send('Error processing request.');
            }

            const sqsParams = {
                QueueUrl: process.env.SQS_QUEUE_URL,
                MessageBody: JSON.stringify({
                    id,
                    fileName: fileName,
                    fileUrl: data.Location
                })
            };

            sqs.sendMessage(sqsParams, (error) => {
                if (error) {
                    console.error('Error:', error);
                    res.status(500).send('Error processing request.');
                }

                res.json({ id });
            });
        });
    });
});

app.get("/view/:id", (req, res) => {
    const { id } = req.params;

    const dynamoDbParams = {
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Item: {
            id
        }
    };

    dynamoDb.get(dynamoDbParams, (error, data) => {
        if (error) {
            console.error('Error:', error);
            res.status(500).send('Error processing request.');
        }

        if (data.Item.status !== "processed") {
            return res.status(202).send('Image is still being processed. Please try again later.');
        }

        const s3Params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: data.Item.processedFileName,
        };

        s3.getObject(s3Params, (error, data) => {
            if (error) {
                console.error('Error:', error);
                res.status(500).send('Error processing request.');
            }

            res.set("Content-Type", data.ContentType);
            res.send(data.Body);
        });
    });
});

app.listen(port, () => {
    console.log("Example app listening at http://localhost:${port}");
})