
async function notification(title, message) {
    await chrome.runtime.sendMessage({
        type: "notification",
        title,
        message
    })
}

// Get current logged-in user
async function getCurrentUserId() {
    try {
        const res = await fetch("https://users.roblox.com/v1/users/authenticated", {
            credentials: "include"
        })

        if (!res.ok) return null

        const data = await res.json()
        return data.id
    } catch {
        return null
    }
}

// Get universeId from placeId
async function getUniverseId(placeId) {
    try {
        const res = await fetch(
            `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`,
            { credentials: "include" }
        )

        const data = await res.json()

        return data?.[0]?.universeId || null
    } catch {
        return null
    }
}

// Main validator
async function isValidGroupPlace(placeId, userId) {
    try {

        const universeId = await getUniverseId(placeId)

        if (!universeId) {
            return { ok: false, error: "Invalid place or universe not found" }
        }

        const gameRes = await fetch(
            `https://games.roblox.com/v1/games?universeIds=${universeId}`,
            { credentials: "include" }
        )

        const gameData = await gameRes.json()
        const game = gameData?.data?.[0]

        if (!game) {
            return { ok: false, error: "Game data not found" }
        }

        // Must be group-owned
        if (game.creator?.type !== "Group") {
            return { ok: false, error: "Place is not owned by a group" }
        }

        const groupId = game.creator.id

        // Check if user owns this group
        const groupsRes = await fetch(
            `https://groups.roblox.com/v1/users/${userId}/groups/roles`,
            { credentials: "include" }
        )

        const groupsData = await groupsRes.json()
        const groups = groupsData?.data || []

        const isUserGroup = groups.some(g =>
            g.group?.id === groupId && g.role?.rank === 255
        )

        if (isUserGroup) {
            return { ok: false, error: "This group belongs to your account" }
        }

        return { ok: true }

    } catch (err) {
        return { ok: false, error: "Roblox API request failed" }
    }
}

(async () => {

    let storageData = await chrome.storage.local.get()

    function saveData(object) {
        chrome.storage.local.set(object)
    }

    $("#rsaver-currect-placeid").text(storageData.placeid || 0)

    $("#rsaver-save").on("click", async () => {

        const input = $("#rsaver-placeid").val()
        if (!input) return

        const placeId = parseInt(input)

        if (isNaN(placeId)) {
            notification("Error", "Invalid PlaceId")
            return
        }

        const userId = await getCurrentUserId()

        if (!userId) {
            notification("Error", "You must be logged into Roblox")
            return
        }

        const check = await isValidGroupPlace(placeId, userId)

        if (!check.ok) {
            notification("Error saving PlaceId", check.error)
            return
        }

        storageData.placeid = placeId
        $("#rsaver-currect-placeid").text(placeId)

        saveData(storageData)

        notification("Success changing placeid", "Refresh the tab to apply changes")
        window.location.reload()
    })

    // news
    let news = await fetch("https://raw.githubusercontent.com/Kelvinouo/RoSaver/master/news.txt")
        .then(r => r.text())

    $(".rsaver").append(news)

    // buttons
    $("#simuna").on("click", () => {
        chrome.tabs.create({
            url: "https://discord.gg/frrQSPVajK",
            active: true
        })
    })

    $("#discord").on("click", () => {
        chrome.tabs.create({
            url: "https://discord.gg/Bc2yG4Ea52",
            active: true
        })
    })

})()
