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

        // Extract title, ID and media type from URL parameters
        urlMetadata: extractUrlMetadata(),

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
        "result",
        "more tutorials",
        "get certified"
    ];
    function isGenericTitle(title) {
        const cleaned = title.trim().toLowerCase();

        if (!cleaned) {
            return true;
        }

        if (genericTitles.includes(cleaned)) {
            return true;
        }

        if (
            /\b(tutorial|reference|exercises|documentation)\b/i
                .test(cleaned)
        ) {
            return true;
        }

        return false;
    }

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

    // 5. URL query parameters
    addCandidate(
        metadata.urlMetadata?.title,
        "urlParameter"
    );

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
            .replace(/[.\_-]+/g, " ")
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
                .replace(/[.\_-]+/g, " ")
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


function extractUrlMetadata() {

    const url = new URL(window.location.href);

    // 1. Extract normal query parameters
    const searchParams = url.searchParams;

    // 2. Extract parameters from the URL hash
    const hash = url.hash;

    const hashContent = hash.startsWith("#")
        ? hash.substring(1)
        : hash;

    const hashParams = new URLSearchParams(hashContent);

    // Read a parameter from either location
    function getParameter(name) {

        const value = (
            searchParams.get(name) ||
            hashParams.get(name) ||
            ""
        ).trim();

        // Reject invalid placeholder values
        if (
            ["false", "null", "undefined", "none"]
                .includes(value.toLowerCase())
        ) {
            return "";
        }

        return value;
    }

    // 3. Extract information from the URL pathname
    const pathSegments = url.pathname
        .split("/")
        .filter(Boolean)
        .map(segment => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return segment;
            }
        });

    let pathId = "";
    let pathType = "";
    let pathSeason = "";
    let pathEpisode = "";

    // Look for movie or TV URL patterns
    for (let i = 0; i < pathSegments.length; i++) {

        const segment = pathSegments[i].toLowerCase();

        if (
            ["movie", "movies", "film"].includes(segment) &&
            /^\d+$/.test(pathSegments[i + 1] || "")
        ) {
            pathType = "movie";
            pathId = pathSegments[i + 1];
            break;
        }

        if (
            ["tv", "show", "shows", "series"].includes(segment) &&
            /^\d+$/.test(pathSegments[i + 1] || "")
        ) {
            pathType = "tv";
            pathId = pathSegments[i + 1];

            // Check for season and episode information
            for (let j = i + 2; j < pathSegments.length; j++) {

                if (
                    pathSegments[j].toLowerCase() === "season" &&
                    /^\d+$/.test(pathSegments[j + 1] || "")
                ) {
                    pathSeason = pathSegments[j + 1];
                }

                if (
                    pathSegments[j].toLowerCase() === "episode" &&
                    /^\d+$/.test(pathSegments[j + 1] || "")
                ) {
                    pathEpisode = pathSegments[j + 1];
                }
            }

            break;
        }
    }

    // 4. Combine query parameters and pathname information
    const id = getParameter("id") ||
        getParameter("tmdb_id") ||
        pathId;

    const type = (
        getParameter("type") ||
        pathType
    ).toLowerCase();

    return {
        title: getParameter("title"),
        id: id,
        type: type,

        season: getParameter("season") || pathSeason,
        episode: getParameter("episode") || pathEpisode,

        source: getParameter("id") || getParameter("tmdb_id")
            ? "queryParameter"
            : pathId
                ? "pathname"
                : null
    };
}

function normalizeEvidenceValue(value) {

    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function deduplicateEvidence(evidence) {

    const uniqueEvidence = new Map();

    evidence.forEach(item => {

        // Identifiers and titles must be handled separately
        const key = `${item.type}:${normalizeEvidenceValue(item.value)}`;

        if (!uniqueEvidence.has(key)) {

            uniqueEvidence.set(key, {
                ...item,
                sources: [item.source]
            });

        } else {

            const existing = uniqueEvidence.get(key);

            // Keep track of all sources
            if (!existing.sources.includes(item.source)) {
                existing.sources.push(item.source);
            }

            // Retain the highest confidence
            existing.confidence = Math.max(
                existing.confidence,
                item.confidence
            );
        }
    });

    return Array.from(uniqueEvidence.values());
}

function rankTitleEvidence(evidence) {

    // Keep only title evidence
    const titleEvidence = evidence.filter(item =>
        item.type === "title"
    );

    // Calculate a score for each title
    const rankedEvidence = titleEvidence.map(item => {

        const sourceCount = item.sources.length;

        // Give a small bonus for multiple supporting sources
        const supportBonus = Math.min(
            (sourceCount - 1) * 0.05,
            0.15
        );

        const score = Math.min(
            item.confidence + supportBonus,
            1.0
        );

        return {
            ...item,
            supportBonus,
            score
        };
    });

    // Highest-scoring title comes first
    rankedEvidence.sort((a, b) =>
        b.score - a.score
    );

    return rankedEvidence;
}

function evaluateRankedEvidence(rankedEvidence) {

    // 1. Check whether any title evidence exists
    if (!rankedEvidence || rankedEvidence.length === 0) {
        return {
            status: "insufficient_information",
            selectedCandidate: null,
            alternatives: []
        };
    }

    const bestCandidate = rankedEvidence[0];
    const secondCandidate = rankedEvidence[1];

    // 2. Check whether the strongest candidate has enough support
    if (bestCandidate.score < 0.6) {
        return {
            status: "insufficient_information",
            selectedCandidate: null,
            alternatives: rankedEvidence
        };
    }

    // 3. Check whether the top two candidates are too close
    if (
        secondCandidate &&
        bestCandidate.score - secondCandidate.score < 0.1
    ) {
        return {
            status: "ambiguous",
            selectedCandidate: null,
            alternatives: rankedEvidence
        };
    }

    // 4. A promising candidate has been found
    return {
        status: "needs_verification",
        selectedCandidate: bestCandidate,
        alternatives: rankedEvidence.slice(1)
    };
}



const EVIDENCE_SOURCE_WEIGHTS = {
    structuredData: 0.95,
    urlParameter: 0.95,
    openGraph: 0.80,
    playerHeading: 0.80,
    twitter: 0.65,
    playerLink: 0.65,
    pageTitle: 0.50,
    videoAsset: 0.55,
    filename: 0.55
};

function collectEvidence(data) {

    const evidence = [];

    // Common website and player branding
    const ignoredPhrases = [
        "free video streaming",
        "video streaming api",
        "watch online",
        "watch free",
        "streaming platform",
        "video player",
        "embed player",
        "home",
        "login",
        "sign in",
        "register",
        "subscribe",
        "advertisement"
    ];

    // Technical identifiers that should not be movie titles
    function isTechnicalIdentifier(value) {

        const compact = value
            .replace(/[\s-]/g, "");

        // Reject UUIDs and long hexadecimal identifiers
        if (/^[a-f0-9]{32,}$/i.test(compact)) {
            return true;
        }

        // Reject purely numeric identifiers
        if (/^\d+$/.test(value.trim())) {
            return true;
        }

        return false;
    }
    // Check whether text looks like website branding
    function isWebsiteNoise(value) {

        const normalized = value
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (!normalized) {
            return true;
        }

        // Reject generic website and player labels
        const ignoredExactPhrases = [
            "player",
            "video player",
            "home",
            "login",
            "sign in",
            "register",
            "subscribe"
        ];

        if (ignoredExactPhrases.includes(normalized)) {
            return true;
        }

        // Reject common player messages
        if (
            normalized.includes("this one won t play right now") ||
            normalized.includes("video is unavailable") ||
            normalized.includes("something went wrong") ||
            normalized.includes("report it") ||
            normalized.includes("discord gg")
        ) {
            return true;
        }

        // Reject existing ignored phrases
        if (ignoredPhrases.some(phrase =>
            normalized === phrase.toLowerCase()
        )) {
            return true;
        }

        // Reject known player/service branding
        const hostname = window.location.hostname
            .replace(/^www\./i, "")
            .split(".")[0]
            .toLowerCase();

        if (
            normalized === hostname ||
            normalized.startsWith(hostname + " ")
        ) {
            return true;
        }

        return false;
    }

    // Add one piece of evidence in a standard format
    function addEvidence(
        value,
        source,
        confidence,
        metadata = {}
    ) {

        if (
            typeof value !== "string" ||
            !value.trim()
        ) {
            return;
        }

        const cleanedValue = value.trim();

        if (isTechnicalIdentifier(cleanedValue)) {
            return;
        }

        if (isWebsiteNoise(cleanedValue)) {
            return;
        }

        evidence.push({
            value: cleanedValue,
            type: "title",
            source: source,
            confidence: EVIDENCE_SOURCE_WEIGHTS[source] ?? confidence,
            metadata: metadata
        });
    }

    // 1. Structured data
    (data.pageMetadata.structuredData || []).forEach(item => {

        addEvidence(
            item.name,
            "structuredData",
            0.95,
            {
                mediaType: item.type,
                year: item.datePublished
                    ? Number(item.datePublished.slice(0, 4))
                    : null,
                season: item.seasonNumber || null,
                episode: item.episodeNumber || null
            }
        );
    });

    // 2. URL title parameter
    const urlMetadata =
        data.pageMetadata.urlMetadata;

    if (urlMetadata?.title) {

        addEvidence(
            urlMetadata.title,
            "urlParameter",
            0.95,
            {
                providerId: urlMetadata.id || null,
                mediaType: urlMetadata.type || null
            }
        );
    }

    // 3. URL identifier
    if (urlMetadata?.id) {
        evidence.push({
            value: urlMetadata.id,
            type: "identifier",
            source: urlMetadata.source || "url",
            confidence: 0.95,
            metadata: {
                mediaType: urlMetadata.type || null,
                season: urlMetadata.season || null,
                episode: urlMetadata.episode || null
            }
        });
    }

    // 4. Open Graph title
    addEvidence(
        data.pageMetadata.openGraph?.title,
        "openGraph",
        0.8
    );

    // 5. Twitter title
    addEvidence(
        data.pageMetadata.twitter?.title,
        "twitter",
        0.65
    );

    // 6. Page title
    addEvidence(
        data.pageMetadata.pageTitle,
        "pageTitle",
        0.5
    );

    // 7. Player headings
    (data.playerContext || [])
        .filter(item => item.level <= 3)
        .forEach(item => {

            (item.headings || []).forEach(heading => {

                addEvidence(
                    heading,
                    "playerHeading",
                    0.8,
                    { ancestorLevel: item.level }
                );
            });
        });

    // 8. Player links
    (data.playerLinks || []).forEach(link => {

        addEvidence(
            link.text,
            "playerLink",
            0.65,
            { href: link.href }
        );
    });

    // 9. Video filename or directory
    const videoInfo = data.videoUrlInfo;

    if (videoInfo?.possibleTitle) {

        addEvidence(
            videoInfo.possibleTitle,
            videoInfo.titleSource || "videoAsset",
            0.55,
            {
                year: videoInfo.possibleYear || null,
                episode: videoInfo.episode || null
            }
        );
    }

    return deduplicateEvidence(evidence);
}



function rankTitleCandidates(data) {

    const candidates = [];

    const sourceWeights = {
        structuredData: 6,
        urlParameter: 6,
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
        "result",
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
    (data.pageMetadata.structuredData || []).forEach(item => {
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

    // 5. URL parameter evidence
    addEvidence(
        data.pageMetadata.urlMetadata?.title,
        "urlParameter",
        `URL ID: ${data.pageMetadata.urlMetadata?.id || "Not available"}, ` +
        `Media type: ${data.pageMetadata.urlMetadata?.type || "Not available"}`
    );

    // 6. Nearby player headings
    (data.playerContext || [])
        .filter(item => item.level <= 3)
        .forEach(item => {
            (item.headings || []).forEach(heading => {
                addEvidence(
                    heading,
                    "playerHeading",
                    `Ancestor level ${item.level}`
                );
            });
        });

    // 7. Nearby player links
    (data.playerLinks || []).forEach(link => {
        addEvidence(
            link.text,
            "playerLink",
            link.href
        );
    });

    // 8. Video filename or directory
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

    // Group sources into broader evidence categories
    const sourceGroups = {
        structuredData: "structuredData",
        urlParameter: "pageMetadata",
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

        const uniqueSources = [
            ...new Set(
                candidate.evidence.map(item => item.source)
            )
        ];

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



function rankTMDBResults(results, candidate, mediaType) {

    if (!results || results.length === 0) {
        return {
            status: "no_results",
            selectedCandidate: null,
            rankedResults: []
        };
    }

    // Normalize titles for comparison
    const normalize = (title) => {
        return (title || "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .replace(/\s+/g, " ")
            .trim();
    };

    const searchTitle = normalize(candidate.title);
    const searchYear = candidate.year || null;

    // Only use this when the ID has been verified as a TMDB ID
    const verifiedTMDBId = candidate.tmdbId
        ? String(candidate.tmdbId)
        : null;

    const rankedResults = results.map(item => {

        const resultTitle = normalize(
            mediaType === "movie" ? item.title : item.name
        );

        const originalTitle = normalize(
            mediaType === "movie"
                ? item.original_title
                : item.original_name
        );

        const releaseDate = mediaType === "movie"
            ? item.release_date
            : item.first_air_date;

        const resultYear = releaseDate
            ? Number(releaseDate.slice(0, 4))
            : null;

        let score = 0;
        const evidence = [];

        // 1. Exact TMDB ID match
        if (
            verifiedTMDBId &&
            String(item.id) === verifiedTMDBId
        ) {
            score += 100;
            evidence.push("Exact verified TMDB ID match");
        }

        // 2. Compare displayed title
        if (resultTitle === searchTitle) {
            score += 10;
            evidence.push("Exact title match");
        }

        // 3. Compare original title
        if (originalTitle === searchTitle) {
            score += 2;
            evidence.push("Exact original title match");
        }

        // 4. Compare release year when available
        if (searchYear && resultYear) {

            if (searchYear === resultYear) {
                score += 5;
                evidence.push("Release year matches");
            } else {
                score -= 5;
                evidence.push("Release year mismatch");
            }
        }

        // 5. Check whether the overview contains useful information
        const overview = (item.overview || "").trim();

        if (
            overview.length > 30 &&
            !/honestly i don't know what to put here/i.test(overview)
        ) {
            score += 2;
            evidence.push("Meaningful overview available");
        }

        // 6. Use vote count as a small supporting signal
        if (item.vote_count >= 10) {
            score += 1;
            evidence.push("More than 10 votes");
        }

        return {
            ...item,
            matchScore: score,
            matchEvidence: evidence,
            matchedYear: resultYear
        };
    });

    // Sort by matching score
    rankedResults.sort(
        (a, b) => b.matchScore - a.matchScore
    );

    const topResult = rankedResults[0];
    const secondResult = rankedResults[1];

    // Only one result exists
    if (rankedResults.length === 1) {
        return {
            status: "needs_verification",
            selectedCandidate: topResult,
            rankedResults
        };
    }

    const scoreDifference =
        topResult.matchScore - secondResult.matchScore;

    // Similar scores mean the results remain ambiguous
    if (scoreDifference < 3) {
        return {
            status: "ambiguous",
            selectedCandidate: null,
            rankedResults
        };
    }

    return {
        status: "needs_verification",
        selectedCandidate: topResult,
        rankedResults
    };
}



function buildTMDBVerification(match, sourceCandidate, mediaType) {

    if (!match) {
        return {
            status: "no_match",
            message: "No TMDB candidate available."
        };
    }

    // Get the correct title fields based on media type
    const tmdbTitle = mediaType === "movie"
        ? match.title
        : match.name;

    const originalTitle = mediaType === "movie"
        ? match.original_title
        : match.original_name;

    // Extract release date
    const releaseDate = mediaType === "movie"
        ? match.release_date
        : match.first_air_date;

    const releaseYear = releaseDate
        ? Number(releaseDate.slice(0, 4))
        : null;

    // Normalize titles for comparison
    function normalize(title) {
        return (title || "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    // Compare extracted title with TMDB title
    const exactTitleMatch =
        normalize(sourceCandidate.title) === normalize(tmdbTitle);

    const originalTitleMatch =
        normalize(sourceCandidate.title) === normalize(originalTitle);

    // Compare years only when both are available
    const sourceYear = sourceCandidate.year || null;

    let yearComparison = "unavailable";

    if (sourceYear && releaseYear) {
        yearComparison = sourceYear === releaseYear
            ? "match"
            : "mismatch";
    }

    // Prepare the verification report
    return {
        status: "awaiting_user_confirmation",

        tmdb: {
            id: match.id,
            mediaType: mediaType,
            title: tmdbTitle,
            originalTitle: originalTitle,
            releaseDate: releaseDate || null,
            releaseYear: releaseYear,
            overview: match.overview || "",
            voteAverage: match.vote_average,
            voteCount: match.vote_count
        },

        comparison: {
            sourceTitle: sourceCandidate.title,
            sourceYear: sourceYear,
            exactTitleMatch: exactTitleMatch,
            originalTitleMatch: originalTitleMatch,
            yearComparison: yearComparison
        },

        ranking: {
            score: match.matchScore,
            evidence: match.matchEvidence
        }
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

        // New: store all collected evidence
        evidence: [],

        // Keep the old pipeline temporarily
        titleCandidates: [],
        identificationResult: null
    };

    // 7. Collect evidence from different sources
    identificationData.evidence =
        collectEvidence(identificationData);

    // 8. Rank collected title evidence
    identificationData.rankedEvidence =
        rankTitleEvidence(identificationData.evidence);

    // 9. Evaluate ranked title evidence
    identificationData.evidenceResult =
        evaluateRankedEvidence(
            identificationData.rankedEvidence
        );

    // 10. Existing identification pipeline
    identificationData.titleCandidates =
        rankTitleCandidates(identificationData);

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

        // Mark this video as detected
        detectedVideos.add(video);

        console.log("Video detected:", video);

        // Listen for video playback
        video.addEventListener("play", () => {

            console.log("VIDEO STARTED");

            // Step 1: Collect identification information
            const identificationData =
                buildIdentificationData(video);

            console.log(
                "IDENTIFICATION DATA:",
                identificationData
            );

            // ------------------------------------------------
            // METHOD 1: DIRECT IDENTIFICATION USING URL ID
            // ------------------------------------------------

            const urlMetadata =
                identificationData.pageMetadata.urlMetadata;

            // Function to retrieve movie details using an ID
            function requestMovieDetails(movieId, expectedTitle) {

                console.log("DIRECT TMDB LOOKUP:", {
                    movieId: movieId,
                    title: expectedTitle
                });

                chrome.runtime.sendMessage(
                    {
                        type: "TMDB_MOVIE_DETAILS",
                        movieId: Number(movieId)
                    },
                    (response) => {

                        if (chrome.runtime.lastError) {
                            console.error(
                                "MOVIE DETAILS MESSAGE ERROR:",
                                chrome.runtime.lastError.message
                            );

                            // Fall back to title search
                            searchByTitle();
                            return;
                        }

                        if (!response || !response.success) {
                            console.error(
                                "DIRECT TMDB LOOKUP FAILED:",
                                response?.error || "Unknown error"
                            );

                            // Fall back to title search
                            searchByTitle();
                            return;
                        }

                        const movie = response.data;

                        console.log(
                            "DIRECT TMDB MOVIE DETAILS:",
                            movie
                        );

                        // Normalize titles before comparison
                        const normalize = (value) =>
                            (value || "")
                                .toLowerCase()
                                .replace(/[^\p{L}\p{N}\s]/gu, "")
                                .replace(/\s+/g, " ")
                                .trim();

                        // Verify title only when one is available
                        const titleMatches = expectedTitle
                            ? normalize(movie.title) ===
                              normalize(expectedTitle)
                            : true;

                        if (!titleMatches) {

                            console.warn(
                                "MOVIE TITLE MISMATCH:",
                                {
                                    urlTitle: expectedTitle,
                                    tmdbTitle: movie.title
                                }
                            );

                            // Do not trust the ID if titles differ
                            searchByTitle();
                            return;
                        }

                        // Display the retrieved movie information
                        const movieDetails = {
                            id: movie.id,
                            title: movie.title,
                            releaseDate: movie.release_date,
                            runtime: movie.runtime,
                            genres: (movie.genres || []).map(
                                genre => genre.name
                            )
                        };

                        if (expectedTitle) {

                            console.log(
                                "TMDB MOVIE VERIFIED:",
                                movieDetails
                            );

                        } else {

                            console.log(
                                "TMDB MOVIE DETAILS RETRIEVED - TITLE VERIFICATION PENDING:",
                                movieDetails
                            );

                        }

                    }
                );
            }


            // ------------------------------------------------
            // METHOD 2: FALLBACK USING TITLE SEARCH
            // ------------------------------------------------

            function searchByTitle() {

                console.log(
                    "USING TITLE-BASED IDENTIFICATION"
                );

                // Get the new evidence-based identification result
                const result =
                    identificationData.evidenceResult;

                // Check whether we have a usable candidate
                if (
                    result.status !== "needs_verification" ||
                    !result.selectedCandidate
                ) {
                    console.log(
                        "TMDB SEARCH SKIPPED:",
                        "No sufficiently clear title candidate."
                    );

                    return;
                }

                // Get the selected title
                const title = result.selectedCandidate.value;

                // Decide whether to search movies or TV shows
                const mediaType =
                    urlMetadata?.type === "tv" ||
                    identificationData.videoUrlInfo.episode
                        ? "tv"
                        : "movie";

                console.log("TMDB SEARCH REQUEST:", {
                    title: title,
                    mediaType: mediaType
                });


                // Send the search request to background.js
                chrome.runtime.sendMessage(
                    {
                        type: "TMDB_SEARCH",
                        mediaType: mediaType,
                        query: title
                    },
                    (response) => {

                        if (chrome.runtime.lastError) {
                            console.error(
                                "EXTENSION MESSAGE ERROR:",
                                chrome.runtime.lastError.message
                            );

                            return;
                        }

                        if (!response || !response.success) {
                            console.error(
                                "TMDB SEARCH FAILED:",
                                response?.error || "Unknown error"
                            );

                            return;
                        }

                        // Display TMDB search results
                        console.log(
                            "TMDB SEARCH RESULTS:",
                            response.data
                        );

                        // Rank the TMDB results
                        const rankingResult = rankTMDBResults(
                            response.data.results,
                            {
                                title: title,
                                year: identificationData
                                    .videoUrlInfo.possibleYear,
                                tmdbId: null
                            },
                            mediaType
                        );

                        console.log(
                            "TMDB RANKING RESULT:",
                            rankingResult
                        );

                        console.log(
                            "BEST TMDB MATCH:",
                            rankingResult.selectedCandidate
                        );

                        // Build the verification report
                        const verificationReport =
                            buildTMDBVerification(
                                rankingResult.selectedCandidate,
                                {
                                    title: title,
                                    year: identificationData
                                        .videoUrlInfo.possibleYear
                                },
                                mediaType
                            );

                        console.log(
                            "TMDB VERIFICATION REPORT:",
                            verificationReport
                        );

                        // Request details if a movie match is available
                        if (
                            verificationReport.status ===
                                "awaiting_user_confirmation" &&
                            verificationReport.tmdb &&
                            verificationReport.tmdb.mediaType === "movie"
                        ) {

                            requestMovieDetails(
                                verificationReport.tmdb.id,
                                title
                            );

                        }

                    }
                );
            }


            // ------------------------------------------------
            // DECIDE WHICH IDENTIFICATION METHOD TO USE
            // ------------------------------------------------

            if (
                urlMetadata &&
                urlMetadata.id &&
                urlMetadata.type === "movie" &&
                /^\d+$/.test(urlMetadata.id)
            ) {

                console.log(
                    "MOVIE ID FOUND IN STREAMING URL:",
                    urlMetadata
                );

                requestMovieDetails(
                    urlMetadata.id,
                    urlMetadata.title
                );

            } else {

                console.log(
                    "NO USABLE MOVIE ID IN URL."
                );

                // Use the existing title-based pipeline
                searchByTitle();

            }

        });

        // Listen for video pause
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
