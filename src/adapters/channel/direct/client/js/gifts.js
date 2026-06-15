/* global fetch, showPage */

let _pendingGiftCheckTimer = null;

function loadGifts() {
  fetch("/api/gifts")
    .then(r => r.json())
    .then(gifts => {
      const grid = document.getElementById("gifts-grid");
      if (!Array.isArray(gifts) || !gifts.length) {
        grid.innerHTML = '<div class="empty-state">还没有礼物，让克给你送一个吧~</div>';
        return;
      }
      grid.innerHTML = gifts.map(g => {
        const badge = g.claimed ? '<span class="gift-badge-claimed">已领取</span>' : '';
        const isLetter = g.type === "letter";
        const thumb = isLetter
          ? `<div class="gift-item-letter-thumb"><span class="letter-envelope">&#9993;</span></div>`
          : `<div class="gift-item-img-wrap"><img src="/api/gifts/${g.id}/image" alt="${g.title || ''}" loading="lazy">${badge}</div>`;
        const badgeHtml = isLetter ? badge : '';
        return `
          <div class="gift-item ${g.claimed ? 'claimed' : ''} ${isLetter ? 'gift-letter' : ''}" onclick="${g.claimed ? '' : `showGiftPopup('${g.id}')`}">
            ${thumb}
            ${isLetter && badgeHtml ? badgeHtml : ''}
            <div class="gift-item-title">${escHtml(g.title || '礼物')}</div>
            <div class="gift-item-date">${formatDate(g.createdAt)}</div>
          </div>`;
      }).join("");
    })
    .catch(err => console.error("[gifts] load error:", err));
}

function showGiftPopup(id) {
  fetch("/api/gifts")
    .then(r => r.json())
    .then(gifts => {
      const gift = (Array.isArray(gifts) ? gifts : []).find(g => g.id === id);
      if (!gift) return;
      const isLetter = gift.type === "letter";
      const cardImgWrap = document.querySelector(".gift-card-img-wrap");
      const cardImg = document.getElementById("gift-card-img");
      const cardTitle = document.getElementById("gift-card-title");
      const cardMsg = document.getElementById("gift-card-msg");
      const card = document.querySelector(".gift-card");

      card.classList.toggle("gift-card-letter", isLetter);

      if (isLetter) {
        if (cardImgWrap) cardImgWrap.style.display = "none";
        cardTitle.innerHTML = escHtml(gift.title || "一封信");
        cardMsg.innerHTML = formatLetterMessage(gift.message || "");
      } else {
        if (cardImgWrap) cardImgWrap.style.display = "";
        cardImg.src = `/api/gifts/${gift.id}/image`;
        cardTitle.textContent = gift.title || "礼物";
        cardMsg.textContent = gift.message || gift.description || "";
      }
      document.getElementById("gift-card-claim").onclick = () => claimGift(gift.id);
      document.getElementById("gift-popup").classList.add("show");
    })
    .catch(err => console.error("[gifts] popup error:", err));
}

function formatLetterMessage(msg) {
  const paragraphs = String(msg || "").split(/\n{2,}/);
  return paragraphs.map(p =>
    `<p>${escHtml(p).replace(/\n/g, "<br>")}</p>`
  ).join("");
}

function claimGift(id) {
  fetch(`/api/gifts/${id}/claim`, { method: "POST" })
    .then(r => r.json())
    .then(() => {
      document.getElementById("gift-popup").classList.remove("show");
      loadGifts();
    })
    .catch(err => console.error("[gifts] claim error:", err));
}

document.getElementById("gift-card-img").addEventListener("click", (e) => {
  e.stopPropagation();
});

document.getElementById("gift-popup").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById("gift-popup").classList.remove("show");
  }
});

// Check for new gifts periodically (poll every 2 min)
function startGiftPolling() {
  let lastCount = 0;
  _pendingGiftCheckTimer = setInterval(() => {
    fetch("/api/gifts")
      .then(r => r.json())
      .then(gifts => {
        if (!Array.isArray(gifts)) return;
        const unclaimed = gifts.filter(g => !g.claimed);
        if (unclaimed.length > lastCount && lastCount > 0) {
          const newest = unclaimed[0];
          showGiftPopup(newest.id);
        }
        lastCount = unclaimed.length;
      })
      .catch(() => {});
  }, 120_000);
}
startGiftPolling();

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return iso; }
}
