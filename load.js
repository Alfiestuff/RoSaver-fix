let rsaver_placeid
let currentUrl = window.location.href
let isInitializing = false
let pendingPurchaseInfo = null // Track info from clicked store card
 
// Check if current URL is an item detail page (has numeric ID)
function isItemDetailPage(url = window.location.href) {
	// Match patterns like /catalog/12345/..., /bundles/12345/..., /game-pass/12345/...
	const match = url.match(/\/(catalog|bundles|game-pass)\/(\d+)/)
	return match !== null
}
 
function waitForElm(selector, timeout = 5000) {
	return new Promise((resolve, reject) => {
		if (document.querySelector(selector)) {
			return resolve(document.querySelector(selector));
		}
 
		const observer = new MutationObserver(mutations => {
			if (document.querySelector(selector)) {
				resolve(document.querySelector(selector));
				observer.disconnect();
			}
		});
 
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
 
		setTimeout(() => {
			observer.disconnect();
			reject(new Error(`Element ${selector} not found within ${timeout}ms`));
		}, timeout);
	});
};
 
async function notification(title, message) {
	await chrome.runtime.sendMessage({
		type: "notification",
		title: title,
		message: message
	})
}
 
function makePurchase(productID, savedprice, type) {
	window.open(`roblox://placeId=${rsaver_placeid}&launchData=${productID},${savedprice},${type}`)
	window.location.reload()
};
 
// Clean up previous RoSaver elements
function cleanup() {
	$(".rsaver-savingRobux").remove()
	$(".rsaver").remove()
}

function getNewDialog() {
	return $(".unified-purchase-dialog-content[data-state='open']").first()
}
 
// Extracts the item price from the new dialog
// The item price (not balance) is in the second .text-robux inside the flex row
// that also contains the thumbnail
function getPriceFromNewDialog(dialog) {
	// The price row sits next to the thumbnail: icon + .text-robux + .text-secondary
	// We want the price in the item info section, not the balance at the top
	let price = 0
 
	// Look for price next to the item thumbnail block
	const itemInfoBlock = dialog.find(".min-w-0.flex.flex-col")
	if (itemInfoBlock.length > 0) {
		const robuxText = itemInfoBlock.find(".text-robux").first().text().replace(/,/g, "").trim()
		price = parseInt(robuxText) || 0
	}
 
	// Fallback: second .text-robux in the dialog (first is balance)
	if (!price) {
		const allRobux = dialog.find(".text-robux")
		if (allRobux.length >= 2) {
			price = parseInt($(allRobux[1]).text().replace(/,/g, "").trim()) || 0
		}
	}
 
	return price
}
 
// Extracts the item name from the new dialog
function getNameFromNewDialog(dialog) {
	return dialog.find(".font-bold").first().text().trim()
}

function setupStoreCardTracking() {
	$(document).off('click.rosaver-track').on('click.rosaver-track', function(e) {
		const target = $(e.target)
		
		const isBuyButton = target.is('button') || target.closest('button').length > 0
		const isStoreCard = target.closest('.store-card, [class*="store-card"], .game-pass-container, [class*="game-pass"]').length > 0
		
		if (!isBuyButton && !isStoreCard) return
		
		const card = target.closest('.store-card, [class*="store-card"], .game-pass-container, [class*="game-pass"]')
		if (card.length === 0) return
		
		let passId = null
		let price = 0
		
		// Method 1: game-pass link in the card
		const passLink = card.find('a[href*="game-pass"]').attr('href') || 
		                 card.attr('href') ||
		                 card.closest('a[href*="game-pass"]').attr('href')
		if (passLink) {
			const match = passLink.match(/game-pass\/(\d+)/)
			if (match) passId = match[1]
		}
		
		// Method 2: data attributes
		if (!passId) {
			const dataAttrs = ['data-item-id', 'data-pass-id', 'data-product-id', 'data-id', 'data-asset-id']
			for (const attr of dataAttrs) {
				passId = card.attr(attr) || card.find(`[${attr}]`).attr(attr)
				if (passId) break
			}
		}
		
		// Method 3: numeric ID in container attributes
		if (!passId) {
			const allAttrs = card[0].attributes
			for (let i = 0; i < allAttrs.length; i++) {
				const match = allAttrs[i].value.match(/^(\d{8,})$/)
				if (match) { passId = match[1]; break }
			}
		}
		
		// Get price
		const priceText = card.find('.text-robux').first().text().replace(/,/g, '')
		price = parseInt(priceText) || 0
		
		if (passId) {
			pendingPurchaseInfo = { productID: passId, price: price, type: 2 }
			console.log('RoSaver - Tracked store card click:', pendingPurchaseInfo)
		} else if (price > 0) {
			pendingPurchaseInfo = { productID: null, price: price, type: 2 }
			console.log('RoSaver - Tracked price but no pass ID:', price)
		}
	})
	
	// Intercept fetch to capture pass ID from API calls
	const originalFetch = window.fetch
	window.fetch = async function(...args) {
		const response = await originalFetch.apply(this, args)
		try {
			const url = args[0].toString()
			if (url.includes('game-pass') || url.includes('gamepass')) {
				const match = url.match(/\/(\d{8,})/)
				if (match && pendingPurchaseInfo) {
					pendingPurchaseInfo.productID = match[1]
					console.log('RoSaver - Got pass ID from fetch:', match[1])
				}
			}
		} catch (e) {}
		return response
	}
}

function addGlobalSaveButton() {
	if ($('.rsaver').length > 0) return
	if (rsaver_placeid == 0 || !rsaver_placeid) return
	
	// ── Try the NEW unified dialog first ──
	const newDialog = getNewDialog()
	if (newDialog.length > 0) {
		addSaveButtonToNewDialog(newDialog)
		return
	}
 
	// ── Fallback to legacy modal selectors ──
	let confirmButton = null
	const buttonSelectors = [
		"[data-testid='purchase-confirm-button']",
		".unified-purchase-dialog-content button",
		"div[role='dialog'] button[data-testid='purchase-confirm-button']",
		".foundation-web-button",
		".modal-button.btn-primary-md.btn-min-width",
		"#confirm-btn",
		".btn-primary-lg[type='button']",
		".modal-footer .btn-primary-md",
		".modal-buttons .btn-primary-md",
		".purchase-modal button.btn-primary-md",
		"[data-testid='confirm-btn']",
		".modal-content button.btn-primary-md"
	]
	
	for (const selector of buttonSelectors) {
		const btn = $(selector).not(".rsaver").first()
		if (btn.length > 0 && btn.text().toLowerCase().includes('buy')) {
			confirmButton = btn; break
		}
	}
	if (!confirmButton || confirmButton.length === 0) {
		for (const selector of buttonSelectors) {
			const btn = $(selector).not(".rsaver").first()
			if (btn.length > 0) { confirmButton = btn; break }
		}
	}
	if (!confirmButton || confirmButton.length === 0) return
 
	// Get price
	const modalPriceElm = $(".modal-body .text-robux, .modal-message .text-robux, div[role='dialog'] .text-robux").last()
	let price = 0
	let productID = null
	let type = 2
 
	if (modalPriceElm.length > 0) {
		price = parseInt(modalPriceElm.text().replace(/,/g, '')) || 0
	}
 
	if (isItemDetailPage()) {
		productID = window.location.toString().split("/")[4]
		if (window.location.href.indexOf("game-pass") > -1) type = 2
		else if (window.location.href.indexOf("bundles") > -1) type = 3
		else type = 1
	} else if (pendingPurchaseInfo) {
		productID = pendingPurchaseInfo.productID
		type = pendingPurchaseInfo.type
		if (!price && pendingPurchaseInfo.price) price = pendingPurchaseInfo.price
	}
 
	if (!productID || !price) {
		console.log('RoSaver - Could not determine product ID or price. ID:', productID, 'Price:', price)
		return
	}
 
	const savedRobux = Math.floor(price * (type === 1 ? 0.4 : 0.1))
	if (savedRobux <= 0) return
 
	injectSaveButton(confirmButton, savedRobux, productID, type, "prepend")
}
 
// Handles the NEW Roblox unified-purchase dialog
function addSaveButtonToNewDialog(dialog) {
	if (dialog.find('.rsaver').length > 0) return
 
	const price = getPriceFromNewDialog(dialog)
	if (!price) {
		console.log('RoSaver - New dialog: could not read price')
		return
	}
 
	let productID = null
	let type = 2
 
	// On item detail pages we can read the ID from the URL
	if (isItemDetailPage()) {
		productID = window.location.toString().split("/")[4]
		if (window.location.href.indexOf("game-pass") > -1) type = 2
		else if (window.location.href.indexOf("bundles") > -1) type = 3
		else type = 1
	} else if (pendingPurchaseInfo) {
		productID = pendingPurchaseInfo.productID
		type = pendingPurchaseInfo.type || 2
	}
 
	// Try to sniff pass ID from the dialog thumbnail URL if still missing
	if (!productID) {
		const imgSrc = dialog.find("img").attr("src") || ""
		// Roblox CDN paths sometimes embed an asset ID – best-effort extraction
		const cdnMatch = imgSrc.match(/\/(\d{6,})\//)
		if (cdnMatch) productID = cdnMatch[1]
	}
 
	if (!productID || !price) {
		console.log('RoSaver - New dialog: could not determine productID or price. ID:', productID, 'Price:', price)
		return
	}
 
	const savedRobux = Math.floor(price * (type === 1 ? 0.4 : 0.1))
	if (savedRobux <= 0) return
 
	// The confirm button in the new dialog
	const confirmButton = dialog.find("[data-testid='purchase-confirm-button']").not(".rsaver").first()
	if (confirmButton.length === 0) {
		console.log('RoSaver - New dialog: confirm button not found')
		return
	}
 
	// Clone & style the Save button
	const clone = confirmButton.clone()
	clone.css({
		"background-color": "#00b06f",
		"border-color": "#00b06f",
		"color": "#fff",
		"margin-right": "8px"
	})
	clone.addClass("rsaver")
	// Match new button's inner span structure
	clone.find(".text-truncate-end").text(`Save ${savedRobux}`)
	// Prepend a small robux icon inside the button label
	clone.find(".gap-small").prepend('<span class="icon-robux-16x16" style="flex-shrink:0;"></span>')
	clone.insertBefore(confirmButton)
 
	clone.on("click", (e) => {
		e.preventDefault()
		e.stopPropagation()
 
		// Dismiss the new radix dialog
		dialog.closest("[role='dialog']").remove()
		$("[data-radix-portal]").remove()
		$("[data-overlay-container]").remove()
		// Also remove any backdrop / overlay elements
		$("div[data-state='open'][class*='overlay']").remove()
 
		makePurchase(productID, savedRobux, type)
		pendingPurchaseInfo = null
	})
 
	console.log('RoSaver - Save button added to new dialog, savings:', savedRobux)
}
 
// Shared helper to clone + inject a save button next to an existing confirm button
function injectSaveButton(confirmButton, savedRobux, productID, type, position = "prepend") {
	const clone = confirmButton.clone()
	clone.css({
		"background-color": "#00b06f",
		"border-color": "#00b06f",
		"color": "#fff"
	})
	clone.addClass("rsaver")
	clone.html(`Save <span class="icon-robux-16x16 wait-for-i18n-format-render"></span> ${savedRobux}`)
 
	if (position === "before") clone.insertBefore(confirmButton)
	else clone.prependTo(confirmButton.parent())
 
	clone.on("click", (e) => {
		e.preventDefault()
		e.stopPropagation()
		$("div[role='dialog']").remove()
		$(".modal-backdrop").remove()
		$(".modal").remove()
		$(".modal-window").remove()
		$("[data-radix-portal]").remove()
		makePurchase(productID, savedRobux, type)
		pendingPurchaseInfo = null
	})
}

function setupGlobalModalObserver() {
	const modalObserver = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.addedNodes.length > 0) {
				// New dialog: unified-purchase-dialog-content
				const hasNewDialog = $(".unified-purchase-dialog-content[data-state='open']").length > 0
				// Legacy modal
				const hasLegacyModal = $('.modal-window, .modal-content, [class*="modal"], div[role="dialog"]').length > 0
				const hasModalButton = $(
					'[data-testid="purchase-confirm-button"], .foundation-web-button, ' +
					'.modal-button, .modal-footer button, .modal-buttons button'
				).length > 0
				
				if ((hasNewDialog || hasLegacyModal) && hasModalButton) {
					setTimeout(() => { addGlobalSaveButton() }, 150)
				}
			}
		}
	})
	
	modalObserver.observe(document.body, { childList: true, subtree: true })
	
	// Click fallback
	$(document).off('click.rosaver-modal').on('click.rosaver-modal', function() {
		setTimeout(() => {
			const noBtn = $('.rsaver').length === 0
			if (noBtn && ($('.unified-purchase-dialog-content').length > 0 || $('.modal-window, .modal-content').length > 0)) {
				addGlobalSaveButton()
			}
		}, 250)
	})
}

function addSavingsToListings() {
	// Game pass store cards – 10% savings
	$(".store-card-price").each(function() {
		if ($(this).find(".rsaver-savingRobux").length > 0) return
		const priceElm = $(this).find(".text-robux")
		if (priceElm.length === 0) return
		const price = parseInt(priceElm.text().replace(/,/g, ""))
		if (isNaN(price) || price === 0) return
		const savedRobux = Math.floor(price * 0.1)
		priceElm.after(`<span class="rsaver-savingRobux text-success font-caption-body" style="margin-left: 4px;">(💰${savedRobux})</span>`)
	})
	
	// Catalog item cards – 40% (10% for bundles)
	$(".item-card-price").each(function() {
		if ($(this).find(".rsaver-savingRobux").length > 0) return
		const itemCard = $(this).closest(".item-card-container, .catalog-item-container, .item-card")
 
		const limitedSelectors = [
			".icon-limited-label", ".icon-limited-unique-label", ".icon-limited",
			".limited-icon", "[class*='limited']", ".item-card-label"
		]
		let isLimited = false
		for (const sel of limitedSelectors) {
			const el = itemCard.find(sel)
			if (el.length > 0) {
				const text = el.text().toLowerCase()
				const cls = el.attr('class') || ''
				if (text.includes('limited') || cls.includes('limited')) { isLimited = true; break }
			}
		}
		if (isLimited) return
 
		const priceElm = $(this).find(".text-robux-tile")
		if (priceElm.length === 0) return
		const price = parseInt(priceElm.text().replace(/,/g, ""))
		if (isNaN(price) || price === 0) return
 
		const itemLink = itemCard.find("a").attr("href") || ""
		const isBundle = itemLink.includes("/bundles/")
		const savedRobux = Math.floor(price * (isBundle ? 0.1 : 0.4))
		priceElm.after(`<span class="rsaver-savingRobux text-success font-caption-body" style="margin-left: 4px;">(💰${savedRobux})</span>`)
	})
}
 
function watchForNewListings() {
	const listingObserver = new MutationObserver((mutations) => {
		let hasNewItems = false
		for (const mutation of mutations) {
			if (mutation.addedNodes.length > 0) {
				for (const node of mutation.addedNodes) {
					if (node.nodeType === 1) {
						if ($(node).find(".store-card-price, .item-card-price").length > 0 || 
							$(node).hasClass("store-card") || 
							$(node).hasClass("item-card-container") ||
							$(node).hasClass("catalog-item-container")) {
							hasNewItems = true; break
						}
					}
				}
			}
			if (hasNewItems) break
		}
		if (hasNewItems) setTimeout(() => { addSavingsToListings() }, 100)
	})
	listingObserver.observe(document.body, { childList: true, subtree: true })
}
 
// ─── ITEM DETAIL PAGE INIT ────────────────────────────────────────────────────
 
async function initRoSaver() {
	if (isInitializing) return
	isInitializing = true
 
	try {
		cleanup()
 
		let storageData = await chrome.storage.local.get()
		if (!storageData.totalSaved) storageData.totalSaved = 0
		if (!storageData.placeid) storageData.placeid = 0
		rsaver_placeid = storageData.placeid
 
		function saveData(object) { chrome.storage.local.set(object) }
		saveData(storageData)
 
		let requireRobuxElm = await waitForElm(".text-robux-lg")
		let requireRobux = $(requireRobuxElm).text().trim()
		
		let infoDiv = await waitForElm("#item-details, .item-details-info-content, .shopping-cart.item-details-info-content")
		infoDiv = $(infoDiv)
		console.log("Init RoSaver - Price:", requireRobux)
 
		let robuxContainerElm = await waitForElm(".icon-robux-price-container, .price-info.row-content .icon-text-wrapper, .item-price-value")
		let robuxContainer = $(robuxContainerElm)
		
		if (requireRobux === "") {
			console.log("RoSaver - No price found, exiting"); return
		}
 
		let productID = window.location.toString().split("/")[4]
		let price = requireRobux.replace(",", "")
		let savedRobux
 
		let imgSrc = ""
		if ($(".thumbnail-2d-container img").length > 0) imgSrc = $(".thumbnail-2d-container img")[0].src
		else if ($("span.thumbnail-span > img").length > 0) imgSrc = $("span.thumbnail-span > img")[0].src
 
		let type = ""
		
		const limitedSelectors = [
			".icon-limited-label", ".icon-limited-unique-label", ".icon-limited",
			".limited-icon", "[class*='limitedIcon']", "[class*='limited-icon']",
			"[data-testid*='limited']", ".asset-restriction-icon .icon-limited-label", ".item-restriction-icon"
		]
		let isLimited = false
		for (const sel of limitedSelectors) {
			if ($(sel).length > 0) { isLimited = true; break }
		}
		if (!isLimited) {
			const pageText = $("#item-details").text() || $(".item-details-info-content").text() || ""
			if (pageText.includes("Limited") || pageText.includes("Collectible")) isLimited = true
		}
		if (!isLimited && $("[data-is-limited='true'], [data-item-status*='limited']").length > 0) isLimited = true
		if (!isLimited) {
			const resaleSection = $(".resale-pricechart-tabs, .resellers-container, #asset-resale-data-container, [class*='resale'], [class*='reseller']")
			if (resaleSection.length > 0 && resaleSection.text().trim() !== "") isLimited = true
		}
		if (!isLimited && $("#tradable-content").text().trim() === "Yes") isLimited = true
		
		if (isLimited) type = "limiteds"
		else if (window.location.href.indexOf("game-pass") > -1) type = 2
		else if (window.location.href.indexOf("bundles") > -1) type = 3
		else type = 1
 
		if (!storageData.placeid || rsaver_placeid == 0) {
			robuxContainer.append(`
				<span class="rsaver-savingRobux rsaver-warning text-error font-caption-header">
					⚠️ RoSaver Setup Required
					<a href="https://www.youtube.com/video/icx6SWPOPQ4" 
					   target="_blank" 
					   class="btn-secondary-xs text-link"
					>📺 Watch Setup Tutorial</a>
				</span>
			`)
			return
		}
		
		savedRobux = Math.floor(price * (type === 2 || type === 3 ? 0.1 : 0.4))
 
		if (type !== "limiteds") {
			robuxContainer.append(`<span class="rsaver-savingRobux">(💰${savedRobux})</span>`)
		} else {
			return
		}
 
		// Add Save button to the new or legacy purchase modal
		function addSaveButton() {
			if ($('.rsaver').length > 0) return
 
			// ── New dialog ──
			const newDialog = getNewDialog()
			if (newDialog.length > 0) {
				addSaveButtonToNewDialog(newDialog)
				return
			}
 
			// ── Legacy modal ──
			let confirmButton = null
			const buttonSelectors = [
				"[data-testid='purchase-confirm-button']",
				".foundation-web-button",
				".modal-button.btn-primary-md.btn-min-width",
				"#confirm-btn",
				".btn-primary-lg[type='button']",
				".modal-footer .btn-primary-md",
				".purchase-modal button.btn-primary-md",
				"[data-testid='confirm-btn']",
				".modal-content button.btn-primary-md"
			]
			for (const sel of buttonSelectors) {
				const btn = $(sel).not(".rsaver").first()
				if (btn.length > 0) { confirmButton = btn; break }
			}
			if (!confirmButton || confirmButton.length === 0) return
			
			try {
				if (confirmButton.offsetParent()[0].toString() == "[object HTMLHtmlElement]") return
			} catch (e) {}
 
			injectSaveButton(confirmButton, savedRobux, productID, type, "prepend")
		}
 
		// Watch for modal/dialog appearing
		const modalObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.addedNodes.length > 0) {
					const hasNewDialog = $(".unified-purchase-dialog-content[data-state='open']").length > 0
					const hasLegacy = $(".modal-window, .modal-content, [class*='modal']").length > 0
					const hasBtn = $(
						"[data-testid='purchase-confirm-button'], .foundation-web-button, " +
						".modal-button, .modal-footer button"
					).length > 0
					if ((hasNewDialog || hasLegacy) && hasBtn) {
						setTimeout(() => { addSaveButton() }, 100)
					}
				}
			}
		})
		modalObserver.observe(document.body, { childList: true, subtree: true })
 
		$(document.body).off("click.rosaver")
		$(document.body).on("click.rosaver", () => {
			setTimeout(() => {
				const hasNewDialog = $(".unified-purchase-dialog-content[data-state='open']").length > 0
				const hasLegacy = $(".modal-window, .modal-content").length > 0
				if ((hasNewDialog || hasLegacy) && $('.rsaver').length === 0) {
					addSaveButton()
				}
			}, 200)
		})
 
	} catch (error) {
		console.log("RoSaver - Error or timeout:", error.message)
	} finally {
		isInitializing = false
	}
}
 
// ─── URL CHANGE WATCHER ───────────────────────────────────────────────────────
 
function watchForUrlChanges() {
	setInterval(() => {
		if (currentUrl !== window.location.href) {
			console.log("RoSaver - URL changed to:", window.location.href)
			currentUrl = window.location.href
			
			if (isItemDetailPage(currentUrl)) {
				console.log("RoSaver - Item detail page detected, reinitializing...")
				setTimeout(() => { initRoSaver() }, 800)
			} else {
				cleanup()
				setTimeout(() => { addSavingsToListings() }, 500)
			}
		}
	}, 300)
}
 
window.addEventListener("popstate", () => {
	console.log("RoSaver - Popstate event")
	currentUrl = window.location.href
	
	if (isItemDetailPage(currentUrl)) {
		console.log("RoSaver - Item detail page detected, reinitializing...")
		setTimeout(() => { initRoSaver() }, 800)
	} else {
		cleanup()
		setTimeout(() => { addSavingsToListings() }, 500)
	}
});
 
// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
 
(async () => {
	const storageData = await chrome.storage.local.get()
	rsaver_placeid = storageData.placeid || 0
	
	if (isItemDetailPage()) {
		console.log("RoSaver - Starting on item detail page")
		initRoSaver()
	} else {
		console.log("RoSaver - Not on item detail page, adding savings to listings...")
	}
	
	addSavingsToListings()
	watchForNewListings()
	watchForUrlChanges()
	setupStoreCardTracking()
	setupGlobalModalObserver()
	console.log("RoSaver - Global modal observer and store card tracking set up")
})()
