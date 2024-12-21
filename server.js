const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const favicon = require('serve-favicon');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const PORT = 5500;

// Set FFmpeg binary path
ffmpeg.setFfmpegPath(ffmpegPath);

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(favicon(path.join(__dirname, 'public', 'favicon.png')));

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', './views');

// Multer configuration for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'temp/'); // Store uploaded chunks in the temp folder
    },
    filename: (req, file, cb) => {
        const fileName = req.body.fileName || Date.now();
        cb(null, fileName + '-' + req.body.chunkNumber + path.extname(file.originalname));
    },
});

const upload = multer({ storage });

// In-memory storage for chunked uploads
const chunkedUploads = {};

// Route to handle chunked file upload and merge the chunks
app.post('/api/upload/chunk', upload.single('chunk'), async (req, res) => {
    try {
        const { chunkNumber, totalChunks, fileName } = req.body;

        if (!fileName) {
            return res.status(400).json({ error: 'File name is missing from the request' });
        }

        const chunkFilePath = req.file?.path;
        if (!chunkFilePath) {
            return res.status(400).json({ error: 'Chunk file path is missing' });
        }

        console.log('Received chunk:', { chunkNumber, totalChunks, fileName, chunkFilePath });

        if (!chunkedUploads[fileName]) {
            chunkedUploads[fileName] = {
                totalChunks: parseInt(totalChunks),
                uploadedChunks: new Array(parseInt(totalChunks)),
            };
        }

        chunkedUploads[fileName].uploadedChunks[chunkNumber] = chunkFilePath;

        const uploadedChunksCount = chunkedUploads[fileName].uploadedChunks.filter(Boolean).length;
        if (uploadedChunksCount === chunkedUploads[fileName].totalChunks) {
            const outputFilePath = path.join(__dirname, 'uploads', fileName);
            const writeStream = fs.createWriteStream(outputFilePath);

            // Merge chunks
            const mergeChunks = async () => {
                const chunkPaths = chunkedUploads[fileName].uploadedChunks;
                for (let chunkPath of chunkPaths) {
                    const chunkStream = fs.createReadStream(chunkPath);

                    await new Promise((resolve, reject) => {
                        chunkStream.pipe(writeStream, { end: false });
                        chunkStream.on('end', resolve);
                        chunkStream.on('error', reject);
                    });

                    // Remove chunk file after merging
                    await fs.promises.unlink(chunkPath);
                }

                writeStream.end();

                return new Promise((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                });
            };

            await mergeChunks();
            console.log('All chunks merged successfully.');

            let cloudinaryFilePath = outputFilePath; // Default to original file
            if (path.extname(fileName).toLowerCase() === '.mov') {
                cloudinaryFilePath = await convertMovToMp4(outputFilePath);
            }

            // Upload to Cloudinary
            const result = await cloudinary.uploader.upload(cloudinaryFilePath, {
                resource_type: 'video',
            });

            console.log('Uploaded to Cloudinary:', result.secure_url);

            // Clean up converted file (if applicable)
            if (cloudinaryFilePath !== outputFilePath) {
                await fs.promises.unlink(cloudinaryFilePath);
            }

            // Remove entry from in-memory storage
            delete chunkedUploads[fileName];

            res.json({ cloudinaryUrl: result.secure_url });
        } else {
            res.json({ message: `Chunk ${parseInt(chunkNumber) + 1} uploaded, waiting for other chunks...` });
        }
    } catch (error) {
        console.error('Error during upload:', error);
        res.status(500).json({ error: 'An error occurred during upload', details: error.message });
    }
});

// Function to convert MOV to MP4 using FFmpeg
const convertMovToMp4 = (inputFilePath) => {
    const outputFilePath = inputFilePath.replace('.mov', '.mp4');
    return new Promise((resolve, reject) => {
        ffmpeg(inputFilePath)
            .output(outputFilePath)
            .on('end', () => {
                console.log('Converted MOV to MP4:', outputFilePath);
                resolve(outputFilePath);
            })
            .on('error', reject)
            .run();
    });
};

// Route to finalize the upload after all chunks are uploaded
app.post('/api/upload/complete', async (req, res) => {
    try {
        const { fileName } = req.body;

        if (!fileName) {
            return res.status(400).json({ error: 'File name is missing' });
        }

        // Check if the file exists in the uploads folder
        const filePath = path.join(__dirname, 'uploads', fileName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // If the file is a MOV, convert it to MP4
        const finalFilePath = path.extname(fileName).toLowerCase() === '.mov'
            ? await convertMovToMp4(filePath)
            : filePath;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(finalFilePath, {
            resource_type: 'video',
        });

        console.log('Uploaded to Cloudinary:', result.secure_url);

        // Clean up the final file after uploading
        await fs.promises.unlink(finalFilePath);

        // Send response with Cloudinary URL
        res.json({ cloudinaryUrl: result.secure_url });
    } catch (error) {
        console.error('Error finalizing upload:', error);
        res.status(500).json({ error: 'Error finalizing upload', details: error.message });
    }
});

// Home Route
app.get('/', (req, res) => {
    res.render('index', { title: 'Video Uploader' });
});

// Start the Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
