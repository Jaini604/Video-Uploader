document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('upload-form');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const fileInput = document.getElementById('videoFile');
        const file = fileInput.files[0];

        if (!file) {
            alert('Please select a file to upload.');
            return;
        }

        const fileName = file.name;
        const chunkSize = 50 * 1024; // 50 KB
        let offset = 0;
        let chunkNumber = 0;
        const totalChunks = Math.ceil(file.size / chunkSize);

        try {
            // Upload file in chunks
            while (offset < file.size) {
                const chunk = file.slice(offset, offset + chunkSize);
                const formData = new FormData();
                formData.set('chunk', chunk);
                formData.set('chunkNumber', chunkNumber.toString());
                formData.set('totalChunks', totalChunks.toString());
                formData.set('fileName', fileName);

                const response = await fetch('/api/upload/chunk', {
                    method: 'POST',
                    body: formData,
                });

                if (response.ok) {
                    const data = await response.json();
                    console.log(`Chunk ${chunkNumber + 1}/${totalChunks} uploaded successfully.`);
                    offset += chunkSize;
                    chunkNumber++;
                } else {
                    const errorData = await response.json();
                    console.error('Error uploading chunk:', errorData);
                    alert(`File upload failed at chunk ${chunkNumber + 1}: ${errorData.error || 'Unknown error'}`);
                    return;
                }
            }

            // Finalize the upload after all chunks are sent
            const finalResponse = await fetch('/api/upload/complete', {
                method: 'POST',
                body: JSON.stringify({ fileName }),
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (finalResponse.ok) {
                const data = await finalResponse.json();

                // Display the uploaded video using the Cloudinary URL
                if (data.cloudinaryUrl) {
                    const videoContainer = document.getElementById('video-player');
                    const videoElement = document.createElement('video');
                    videoElement.controls = true;
                    videoElement.src = data.cloudinaryUrl;

                    // Ensure the video container exists before trying to modify it
                    if (videoContainer) {
                        videoContainer.innerHTML = ''; // Clear previous video
                        videoContainer.appendChild(videoElement);

                        videoElement.load();
                        videoElement.play();
                    }

                    // Display the Cloudinary URL
                    const cloudinaryUrlElement = document.getElementById('cloudinary-url');
                    if (cloudinaryUrlElement) {
                        cloudinaryUrlElement.innerHTML = `<a href="${data.cloudinaryUrl}" target="_blank">View Video</a>`;
                    }

                    alert('Video uploaded and ready to play!');
                } else {
                    alert('Upload completed but no video URL received.');
                }
            } else {
                const errorData = await finalResponse.json();
                console.error('Error finalizing upload:', errorData);
                alert(`Error finalizing upload: ${errorData.error}`);
            }
        } catch (error) {
            console.error('Error during upload:', error);
            alert('An unexpected error occurred during upload. Please try again.');
        }
    });
});
