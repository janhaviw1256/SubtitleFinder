
// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        // Handle TMDB movie/TV search requests
        if (message.type === "TMDB_SEARCH") {

            const { mediaType, query } = message;

            if (
                !["movie", "tv"].includes(mediaType) ||
                typeof query !== "string" ||
                !query.trim()
            ) {
                sendResponse({
                    success: false,
                    error: "Invalid search request."
                });

                return;
            }

            const url =
                `http://localhost:3000/api/search/${mediaType}?query=` +
                encodeURIComponent(query.trim());

            fetch(url)
                .then(async response => {
                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(
                            data.error || "TMDB search failed."
                        );
                    }

                    return data;
                })
                .then(data => {
                    sendResponse({
                        success: true,
                        data: data
                    });
                })
                .catch(error => {
                    console.error("TMDB search error:", error);

                    sendResponse({
                        success: false,
                        error: error.message
                    });
                });

            return true;
        }

        // Handle detailed movie information requests
        if (message.type === "TMDB_MOVIE_DETAILS") {

            const { movieId } = message;

            if (
                typeof movieId !== "number" ||
                !Number.isInteger(movieId) ||
                movieId <= 0
            ) {
                sendResponse({
                    success: false,
                    error: "Invalid movie ID."
                });

                return;
            }

            const url =
                `http://localhost:3000/api/movie/${movieId}`;

            fetch(url)
                .then(async response => {
                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(
                            data.error || "Movie details request failed."
                        );
                    }

                    return data;
                })
                .then(data => {
                    sendResponse({
                        success: true,
                        data: data
                    });
                })
                .catch(error => {
                    console.error("Movie details error:", error);

                    sendResponse({
                        success: false,
                        error: error.message
                    });
                });

            return true;
        }
    }
);

console.log("Subtitle Finder background service worker loaded.");
