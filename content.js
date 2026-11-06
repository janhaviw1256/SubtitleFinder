
console.log("Subtitle Finder is active!");

const detectedVideos = new WeakSet();


// Extract structured data embedded in the webpage
function extractJsonLd() {
    const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]'
    );

    const results = [];

    function visit(item) {
        if (Array.isArray(item)) {
            item.forEach(visit);
            return;
        }

        if (!item || typeof item !== "object") {
            return;
        }

        if (item["@type"]) {
            const types = Array.isArray(item["@type"])
                ? item["@type"]
                : [item["@type"]];

            const supportedTypes = [
                "Movie",
                "TVEpisode",
                "TVSeries",
                "VideoObject"
            ];

            if (types.some(type => supportedTypes.includes(type))) {
                results.push({
                    type: types,
                    name: item.name || "",
                    description: item.description || "",
                    datePublished: item.datePublished || "",
                    episodeNumber: item.episodeNumber || "",
                    seasonNumber: item.seasonNumber || "",
                    partOfSeries: item.partOfSeries?.name || "",
                    partOfSeason: item.partOfSeason?.seasonNumber || ""
                });
            }
        }

        Object.values(item).forEach(visit);
    }

    scripts.forEach(script => {
        try {
            const data = JSON.parse(script.textContent);
            visit(data);
        } catch (error) {
            console.warn("Could not parse JSON-LD:", error);
        }
    });

    return results;
}


// Extract useful information from the webpage
function extractPageMetadata() {
    const metadata = {
        pageTitle: document.title,
        pageURL: window.location.href,

        description:
            document.querySelector('meta[name="description"]')
                ?.content || "",

        openGraph: {
            title: document.querySelector('meta[property="og:title"]')
                ?.content || "",

            description: document.querySelector(
                'meta[property="og:description"]'
            )?.content || "",

            type: document.querySelector('meta[property="og:type"]')
                ?.content || ""
        },

        twitter: {
            title: document.querySelector('meta[name="twitter:title"]')
                ?.content || "",

            description: document.querySelector(
                'meta[name="twitter:description"]'
            )?.content || ""
        },

        headings: Array.from(
        document.querySelectorAll("h1")
        ).map(heading => heading.innerText.trim()).filter(Boolean),

        structuredData: extractJsonLd()
    };

    return metadata;
}



function extractPlayerContext(video) {
    const context = [];

    let currentElement = video.parentElement;

    // Examine up to five parent elements
    for (let level = 1; level <= 5; level++) {

        if (!currentElement) {
            break;
        }

        // Extract headings
        const headings = Array.from(
            currentElement.querySelectorAll("h1, h2, h3")
        )
        .map(heading => heading.innerText.trim())
        .filter(Boolean);

        // Extract nearby links
        const links = Array.from(
            currentElement.querySelectorAll("a")
        )
        .map(link => ({
        text: link.innerText.trim(),
        href: link.href,
        title: link.getAttribute("title") || ""
        }))
        .filter(link => link.text || link.title);


        // Extract visible text
        const text = (currentElement.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);

        context.push({
            level: level,

            tagName: currentElement.tagName,

            id: currentElement.id || "",

            className:
                typeof currentElement.className === "string"
                    ? currentElement.className
                    : "",

            titleAttribute:
                currentElement.getAttribute("title") || "",

            ariaLabel:
                currentElement.getAttribute("aria-label") || "",

            headings: [...new Set(headings)],

            links: [...new Set(links)],

            text: text
        });

        currentElement = currentElement.parentElement;
    }

    return context;
}


function extractTitleCandidates(metadata) {
    const candidates = [];

    // Common generic titles that are unlikely to identify a movie
    const genericTitles = [
        "home",
        "watch now",
        "watch online",
        "video",
        "html video",
        "untitled",
        "index"
    ];

    // Check whether a title is useful
    function isGenericTitle(title) {
        const cleaned = title.trim().toLowerCase();

        if (!cleaned) {
            return true;
        }

        if (genericTitles.includes(cleaned)) {
            return true;
        }

        // Filter common tutorial/documentation headings
        if (
            /\b(tutorial|reference|exercises|documentation)\b/i
                .test(cleaned)
        ) {
            return true;
        }

        return false;
    }

    // Add a title while avoiding duplicates
    function addCandidate(title, source) {
        if (typeof title !== "string") {
            return;
        }

        const cleaned = title.trim().replace(/\s+/g, " ");

        if (isGenericTitle(cleaned)) {
            return;
        }

        const existing = candidates.find(
            candidate =>
                candidate.title.toLowerCase() === cleaned.toLowerCase()
        );

        if (existing) {
            if (!existing.sources.includes(source)) {
                existing.sources.push(source);
            }
        } else {
            candidates.push({
                title: cleaned,
                sources: [source]
            });
        }
    }

    // 1. Structured data
    metadata.structuredData?.forEach(item => {
        addCandidate(item.name, "structuredData");
    });

    // 2. Open Graph metadata
    addCandidate(metadata.openGraph?.title, "openGraph");

    // 3. Twitter metadata
    addCandidate(metadata.twitter?.title, "twitter");

    // 4. Page title
    addCandidate(metadata.pageTitle, "pageTitle");


    return candidates;
}


function extractPlayerLinks(playerContext) {
    const results = [];
    const seenLinks = new Set();

    const ignoredLinkTexts = [
        "previous",
        "next",
        "try it yourself",
        "home",
        "login",
        "sign in",
        "share"
    ];

    // Only inspect the three closest ancestor levels
    playerContext
        .filter(item => item.level <= 3)
        .forEach(item => {

            item.links.forEach(link => {
                const text = link.text.trim();
                const normalizedText = text
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}\s]/gu, "")
                    .replace(/\s+/g, " ")
                    .trim();

                if (!text || ignoredLinkTexts.includes(normalizedText)) {
                    return;
                }

                const key = `${normalizedText}|${link.href}`;

                if (seenLinks.has(key)) {
                    return;
                }

                seenLinks.add(key);

                results.push({
                    text: text,
                    href: link.href,
                    title: link.title,
                    level: item.level
                });
            });
        });

    return results;
}



function extractVideoUrlInfo(video) {
    const source = video.currentSrc || video.src;

    if (!source) {
        return {
            source: "",
            filename: "",
            possibleTitle: "",
            possibleYear: null,
            episode: null,
            titleSource: ""
        };
    }

    try {
        const url = new URL(source);

        // Decode and split the URL path
        const pathname = decodeURIComponent(url.pathname);

        const pathSegments = pathname
            .split("/")
            .filter(Boolean);

        // Extract filename
        const filename = pathSegments.length
            ? pathSegments[pathSegments.length - 1]
            : "";

        // Remove file extension
        const filenameWithoutExtension = filename
            .replace(/\.[^/.]+$/, "");

        // Clean filename separators
        const cleanedName = filenameWithoutExtension
            .replace(/[._-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        // Extract release year
        const yearMatch = cleanedName.match(
            /\b(19\d{2}|20\d{2})\b/
        );

        // Extract episode patterns
        const episodeMatch = cleanedName.match(
            /\bS(\d{1,2})E(\d{1,2})\b|\b(\d{1,2})x(\d{1,2})\b/i
        );

        let episode = null;

        if (episodeMatch) {
            episode = {
                season: Number(episodeMatch[1] || episodeMatch[3]),
                episode: Number(episodeMatch[2] || episodeMatch[4])
            };
        }

        // Remove year and episode information
        const filenameTitle = cleanedName
            .replace(/\b(19\d{2}|20\d{2})\b/, "")
            .replace(/\bS\d{1,2}E\d{1,2}\b|\b\d{1,2}x\d{1,2}\b/i, "")
            .replace(/\s+/g, " ")
            .trim();

        // Generic directory names to ignore
        const ignoredDirectories = [
            "series",
            "movies",
            "movie",
            "videos",
            "video",
            "episodes",
            "episode",
            "season",
            "seasons",
            "media",
            "stream",
            "streams",
            "uploads",
            "files"
        ];

        let directoryTitle = "";

        // Search backwards through directories
        for (let i = pathSegments.length - 2; i >= 0; i--) {

            const segment = pathSegments[i];

            const cleanedSegment = segment
                .replace(/[._-]+/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            const normalized = cleanedSegment.toLowerCase();

            // Skip generic directory names
            if (
                !cleanedSegment ||
                ignoredDirectories.includes(normalized) ||
                /^s\d{1,2}$/i.test(segment) ||
                /^season\s*\d+$/i.test(cleanedSegment)
            ) {
                continue;
            }

            directoryTitle = cleanedSegment;
            break;
        }

        // Prefer a meaningful filename title.
        // Otherwise, use a meaningful directory name.
        const possibleTitle = filenameTitle || directoryTitle;

        const titleSource = filenameTitle
            ? "filename"
            : directoryTitle
                ? "directory"
                : "";

        return {
            source: source,
            filename: filename,
            possibleTitle: possibleTitle,
            possibleYear: yearMatch ? Number(yearMatch[0]) : null,
            episode: episode,
            titleSource: titleSource
        };

    } catch (error) {
        console.warn("Could not parse video URL:", error);

        return {
            source: source,
            filename: "",
            possibleTitle: "",
            possibleYear: null,
            episode: null,
            titleSource: ""
        };
    }
}


function rankTitleCandidates(data) {

    const candidates = [];

    const sourceWeights = {
        structuredData: 6,
        playerHeading: 3,
        playerLink: 3,
        filename: 3,
        openGraph: 3,
        twitter: 2,
        directory: 2,
        pageTitle: 1
    };

    const genericTitles = [
        "home",
        "watch now",
        "watch online",
        "video",
        "html video",
        "untitled",
        "index",
        "example",
        "player",
        "more tutorials",
        "get certified"
    ];

    const genericFilenameTitles = [
        "mov bbb",
        "sample",
        "video",
        "movie",
        "file",
        "output",
        "stream",
        "trailer",
        "clip",
        "segment",
        "random123"
    ];

    // Normalize titles for comparison
    function normalizeTitle(title) {
        return title
            .toLowerCase()
            .replace(/[._-]+/g, " ")
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    // Reject obviously unhelpful candidates
    function isInvalidTitle(title) {
        const normalized = normalizeTitle(title);

        if (!normalized) {
            return true;
        }

        if (genericTitles.includes(normalized)) {
            return true;
        }

        if (
            /\b(tutorial|reference|exercises|documentation)\b/i
                .test(normalized)
        ) {
            return true;
        }

        // Reject obvious numeric or generated identifiers
        if (/^\d+$/.test(normalized)) {
            return true;
        }

        if (/^random\d+$/i.test(normalized)) {
            return true;
        }

        if (/^[a-f0-9]{16,}$/i.test(normalized)) {
            return true;
        }

        return false;
    }

    // Add evidence and merge duplicate titles
    function addEvidence(title, source, details = "") {

        if (typeof title !== "string") {
            return;
        }

        const cleanedTitle = title.trim();

        if (isInvalidTitle(cleanedTitle)) {
        return;
        }

        // Reject generic video filenames
        if (
            source === "filename" &&
            genericFilenameTitles.includes(
            normalizeTitle(cleanedTitle)
            )
        ) {
            return;
        }

        const normalized = normalizeTitle(cleanedTitle);

        let candidate = candidates.find(
            item => item.normalizedTitle === normalized
        );

        if (!candidate) {
            candidate = {
                title: cleanedTitle,
                normalizedTitle: normalized,
                score: 0,
                evidence: []
            };

            candidates.push(candidate);
        }

        // Don't count the same source twice
        if (candidate.evidence.some(
            item => item.source === source
        )) {
            return;
        }

        const weight = sourceWeights[source] || 1;

        candidate.score += weight;

        candidate.evidence.push({
            source: source,
            weight: weight,
            details: details
        });
    }


    // 1. JSON-LD evidence
    data.pageMetadata.structuredData.forEach(item => {
        addEvidence(
            item.name,
            "structuredData",
            item.type.join(", ")
        );
    });


    // 2. Open Graph title
    addEvidence(
        data.pageMetadata.openGraph.title,
        "openGraph"
    );


    // 3. Twitter title
    addEvidence(
        data.pageMetadata.twitter.title,
        "twitter"
    );


    // 4. Webpage title
    addEvidence(
        data.pageMetadata.pageTitle,
        "pageTitle"
    );


    // 5. Nearby player headings
    data.playerContext
        .filter(item => item.level <= 3)
        .forEach(item => {
            item.headings.forEach(heading => {
                addEvidence(
                    heading,
                    "playerHeading",
                    `Ancestor level ${item.level}`
                );
            });
        });


    // 6. Nearby player links
    data.playerLinks.forEach(link => {
        addEvidence(
            link.text,
            "playerLink",
            link.href
        );
    });


    // 7. Video filename or directory
    const urlInfo = data.videoUrlInfo;

    if (urlInfo.titleSource === "filename") {
        addEvidence(
            urlInfo.possibleTitle,
            "filename",
            urlInfo.filename
        );
    }

    if (urlInfo.titleSource === "directory") {
        addEvidence(
            urlInfo.possibleTitle,
            "directory",
            urlInfo.source
        );
    }


    // Rank candidates by score
    candidates.sort((a, b) => b.score - a.score);

    // Add descriptive evidence labels
    
// Group sources into broader evidence categories
const sourceGroups = {
    structuredData: "structuredData",

    openGraph: "pageMetadata",
    twitter: "pageMetadata",
    pageTitle: "pageMetadata",

    playerHeading: "playerContext",
    playerLink: "playerContext",

    filename: "videoAsset",
    directory: "videoAsset"
};


// Add evidence levels and evidence summaries
candidates.forEach(candidate => {

    if (candidate.score >= 6) {
        candidate.evidenceLevel = "Strong evidence";
    } else if (candidate.score >= 3) {
        candidate.evidenceLevel = "Some evidence";
    } else {
        candidate.evidenceLevel = "Weak clue";
    }

    // Collect distinct source names
    const uniqueSources = [
        ...new Set(
            candidate.evidence.map(item => item.source)
        )
    ];

    // Collect distinct evidence categories
    const uniqueGroups = [
        ...new Set(
            uniqueSources.map(source => sourceGroups[source])
                .filter(Boolean)
        )
    ];

    candidate.evidenceSummary = {
        sourceCount: uniqueSources.length,

        sources: uniqueSources,

        diversityCount: uniqueGroups.length,

        categories: uniqueGroups
    };

});

return candidates;
}


function evaluateIdentification(candidates) {

    // No usable title candidates
    if (!candidates || candidates.length === 0) {
        return {
            status: "insufficient_information",
            selectedCandidate: null,
            alternatives: []
        };
    }

    // Candidates are already sorted by score
    const topCandidate = candidates[0];

    // Only one candidate exists
    if (candidates.length === 1) {
        return {
            status: "needs_verification",
            selectedCandidate: topCandidate,
            alternatives: []
        };
    }

    const secondCandidate = candidates[1];

    const scoreDifference =
        topCandidate.score - secondCandidate.score;

    // Similar scores indicate ambiguity
    if (scoreDifference <= 2) {
        return {
            status: "ambiguous",
            selectedCandidate: null,
            alternatives: candidates
        };
    }

    // One candidate leads, but still needs verification
    return {
        status: "needs_verification",
        selectedCandidate: topCandidate,
        alternatives: candidates.slice(1)
    };
}



function buildIdentificationData(video) {

    // 1. Extract basic video information
    const videoInfo = {
        source: video.currentSrc || video.src,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight
    };

    // 2. Extract webpage metadata
    const pageMetadata = extractPageMetadata();

    // 3. Extract player context
    const playerContext = extractPlayerContext(video);

    // 4. Extract relevant player links
    const playerLinks = extractPlayerLinks(playerContext);

    // 5. Parse video URL and filename
    const videoUrlInfo = extractVideoUrlInfo(video);

    // 6. Combine all collected information
    const identificationData = {
        collectedAt: new Date().toISOString(),

        video: videoInfo,
        pageMetadata,
        playerContext,
        playerLinks,
        videoUrlInfo,

        titleCandidates: [],
        identificationResult: null
    };

    // 7. Consolidate and rank title evidence
    identificationData.titleCandidates =
        rankTitleCandidates(identificationData);

    // 8. Evaluate the candidates
    identificationData.identificationResult =
        evaluateIdentification(
            identificationData.titleCandidates
        );

    return identificationData;
}


// Detect video elements
function detectVideos() {
    const videos = document.querySelectorAll("video");

    videos.forEach((video) => {
        if (detectedVideos.has(video)) {
            return;
        }

        detectedVideos.add(video);

        console.log("Video detected:", video);

        video.addEventListener("play", () => {
            console.log("VIDEO STARTED");

            const identificationData =
                buildIdentificationData(video);

            console.log(
                "IDENTIFICATION DATA:",
                identificationData
            );

        });

        video.addEventListener("pause", () => {
            console.log("VIDEO PAUSED");
        });
    });
}


// Detect existing videos
detectVideos();


// Detect dynamically added videos
const observer = new MutationObserver(() => {
    detectVideos();
});

observer.observe(document.documentElement, {
    childList: true,
    subtree: true
});



const conflictTest = [
    {
        title: "Interstellar",
        normalizedTitle: "interstellar",
        score: 9,
        evidence: [
            { source: "openGraph", weight: 3 },
            { source: "playerLink", weight: 3 }
        ]
    },
    {
        title: "Inception",
        normalizedTitle: "inception",
        score: 3,
        evidence: [
            { source: "filename", weight: 3 },
            { source: "directory", weight: 2 }
        ]
    }
];

console.log(
    "EMPTY TEST:",
    evaluateIdentification([])
);