
// Load environment variables
require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());


// 1. Check whether the server is running
app.get("/", (req, res) => {
    res.json({
        message: "Subtitle Finder backend is running!"
    });
});


// 2. Search for movies using TMDB
app.get("/api/search/movie", async (req, res) => {
    try {
        const query = req.query.query;

        if (!query || !query.trim()) {
            return res.status(400).json({
                error: "Movie title is required."
            });
        }

        const response = await fetch(
            "https://api.themoviedb.org/3/search/movie?query=" +
            encodeURIComponent(query),
            {
                headers: {
                    Authorization:
                        `Bearer ${process.env.TMDB_READ_ACCESS_TOKEN}`,
                    accept: "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: "TMDB request failed.",
                details: data.status_message
            });
        }

        res.json(data);

    } catch (error) {
        console.error("Movie search error:", error);

        res.status(500).json({
            error: "Internal server error."
        });
    }
});


// 3. Search for TV shows using TMDB
app.get("/api/search/tv", async (req, res) => {
    try {
        const query = req.query.query;

        if (!query || !query.trim()) {
            return res.status(400).json({
                error: "TV show title is required."
            });
        }

        const response = await fetch(
            "https://api.themoviedb.org/3/search/tv?query=" +
            encodeURIComponent(query),
            {
                headers: {
                    Authorization:
                        `Bearer ${process.env.TMDB_READ_ACCESS_TOKEN}`,
                    accept: "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: "TMDB request failed.",
                details: data.status_message
            });
        }

        res.json(data);

    } catch (error) {
        console.error("TV search error:", error);

        res.status(500).json({
            error: "Internal server error."
        });
    }
});


// 4. Get movie details using a TMDB movie ID
app.get("/api/movie/:id", async (req, res) => {
    try {
        const movieId = req.params.id;

        // Validate the movie ID
        if (!/^\d+$/.test(movieId)) {
            return res.status(400).json({
                error: "Invalid movie ID."
            });
        }

        // Request movie details from TMDB
        const response = await fetch(
            `https://api.themoviedb.org/3/movie/${movieId}`,
            {
                headers: {
                    Authorization:
                        `Bearer ${process.env.TMDB_READ_ACCESS_TOKEN}`,
                    accept: "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: "TMDB movie lookup failed.",
                details: data.status_message
            });
        }

        res.json(data);

    } catch (error) {
        console.error("Movie details error:", error);

        res.status(500).json({
            error: "Internal server error."
        });
    }
});


// Start server
app.listen(PORT, () => {
    console.log(`Subtitle Finder backend running on port ${PORT}`);
});
