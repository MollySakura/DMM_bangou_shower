// ==UserScript==
// @name         DMM番号展示
// @namespace    https://github.com/MollySakura/DMM_bangou_shower/blob/main/dmm_bangou_shower.user.js
// @version      4.2
// @license      GPL License
// @description  在商品标题下方展示番号，兼容新版列表布局
// @author       Melody
// @include      https://*.dmm.co.*/*
// @include      https://*.mgstage.*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=dmm.co.jp
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const ROW_ATTR = 'data-dmm-cid-row';
    const BADGE_ATTR = 'data-dmm-cid-badge';
    const LINK_SELECTOR = 'a[href*="/cid="], a[href*="/cid/"], a[href*="/av/content/"]';
    const TITLE_SELECTOR = '[data-e2eid="title"], [data-testid="title"], .product-items_title, .product-items_name, p.ttl, p.title, h2, h3';
    const MEDIA_SELECTOR = 'img, picture, video, canvas, .product-items_package';
    const rows = new Map();

    // 不再使用 closest('.flex')：它常常是封面/工具栏的横向容器。
    // 只给脚本自己的元素设置样式，不修改官网封面高度。
    const style = (element, rules) => {
        Object.entries(rules).forEach(([key, value]) => element.style.setProperty(key, value, 'important'));
    };

    const extractCID = (href) => {
        try {
            const url = new URL(href, location.origin);
            const match = url.pathname.match(/\/(?:cid=|cid\/)([^/?&]+)/i);
            if (match) return decodeURIComponent(match[1]);
            if (/\/av\/content\/?$/i.test(url.pathname)) return url.searchParams.get('id');
        } catch (error) {
            // 忽略无效链接。
        }
        return null;
    };

    const formatCID = (rawCID) => {
        const match = rawCID.match(/.*?([a-z]+)(\d+)$/i);
        if (!match) return rawCID;
        return `${match[1].toUpperCase()}-${(match[2].replace(/^0+/, '') || '0').padStart(3, '0')}`;
    };

    const copyCID = async (text) => {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (error) {
                // 不可用时尝试旧版剪贴板接口。
            }
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        style(textarea, { position: 'fixed', left: '-9999px', top: '0' });
        document.body.appendChild(textarea);
        try {
            textarea.select();
            if (!document.execCommand('copy')) throw new Error('复制失败');
        } finally {
            textarea.remove();
        }
    };

    const createRow = (rawCID) => {
        const cid = formatCID(rawCID);
        // span 也可安全插入标题的 p/a 内部，不使用会被官网样式选中的通用类名。
        const row = document.createElement('span');
        row.setAttribute(ROW_ATTR, rawCID);
        style(row, {
            display: 'block', position: 'static', float: 'none', clear: 'both',
            width: 'auto', 'max-width': '100%', 'min-width': '0',
            height: 'auto', margin: '4px 0', padding: '0',
            'box-sizing': 'border-box', 'line-height': '1.4',
            'grid-column': '1 / -1', 'flex-shrink': '0',
        });
        const badge = document.createElement('span');
        badge.setAttribute(BADGE_ATTR, '');
        badge.setAttribute('role', 'button');
        badge.tabIndex = 0;
        badge.textContent = cid;
        badge.title = '点击复制番号';
        style(badge, {
            display: 'inline-block', position: 'static', float: 'none',
            color: 'rgb(198, 40, 40)', 'font-size': '12px', 'font-weight': '600',
            padding: '4px 8px', background: 'rgb(255, 235, 238)',
            'border-radius': '4px', border: '1px solid rgb(239, 154, 154)',
            margin: '0', 'line-height': '1.4', cursor: 'pointer',
            'box-sizing': 'border-box', 'max-width': '100%',
            'white-space': 'normal', 'overflow-wrap': 'anywhere',
            'text-decoration': 'none', 'text-align': 'left',
        });
        let resetTimer;
        const copy = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            clearTimeout(resetTimer);
            try {
                await copyCID(cid);
                badge.textContent = `${cid} (已复制)`;
            } catch (error) {
                badge.textContent = `${cid} (复制失败)`;
            }
            resetTimer = setTimeout(() => { badge.textContent = cid; }, 1200);
        };
        badge.addEventListener('click', copy);
        badge.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') copy(event);
        });
        row.appendChild(badge);
        return row;
    };

    const textWithoutBadge = (element) => {
        // 克隆仅用于读标题文本，不改动官网节点及其事件监听器。
        if (!element.querySelector(`[${ROW_ATTR}]`)) return element.textContent.trim();
        const clone = element.cloneNode(true);
        clone.querySelectorAll(`[${ROW_ATTR}]`).forEach(row => row.remove());
        return clone.textContent.trim();
    };

    const isTitle = (element, rawCID) => {
        if (!textWithoutBadge(element) || element.querySelector(MEDIA_SELECTOR)) return false;
        if (element.closest('.product-items_package, button, [role="button"]')) return false;
        const link = element.closest('a[href]');
        return !link || extractCID(link.href) === rawCID;
    };

    const findTitle = (link, rawCID) => {
        const regions = [];
        // 以商品链接为边界向上找。遇到其他商品立即停止，不扩展到整个列表。
        for (let node = link, depth = 0; node && node !== document.body && depth < 9; node = node.parentElement, depth++) {
            const differentProduct = Array.from(node.querySelectorAll(LINK_SELECTOR)).some(other => {
                const otherCID = extractCID(other.href);
                return otherCID && otherCID !== rawCID;
            });
            if (differentProduct) break;
            regions.push(node);
        }
        for (const region of regions) {
            const candidates = [...(region.matches(TITLE_SELECTOR) ? [region] : []), ...region.querySelectorAll(TITLE_SELECTOR)];
            const title = candidates.find(candidate => isTitle(candidate, rawCID));
            if (title) return title;
        }
        for (const region of regions) {
            const candidates = [...(region.matches('a[href]') ? [region] : []), ...region.querySelectorAll(LINK_SELECTOR)];
            const title = candidates.find(candidate => {
                if (extractCID(candidate.href) !== rawCID || !isTitle(candidate, rawCID)) return false;
                const text = textWithoutBadge(candidate);
                return !/^(?:サンプル|再生|詳細|お気に入り|play|sample|preview|\d+[\s,.]*円)/i.test(text);
            });
            if (title) return title;
        }
        return null;
    };

    const findAnchor = (title) => {
        let anchor = title;
        // 将只有标题和标签的包装层作为整体，避免把番号插进横向标题行。
        for (let depth = 0; anchor.parentElement && depth < 4; depth++) {
            const parent = anchor.parentElement;
            if (parent === document.body || parent.querySelector(`${MEDIA_SELECTOR}, button, [role="button"]:not([${BADGE_ATTR}])`)) break;
            if (parent.querySelectorAll('a[href]').length > 1) break;
            const parentStyle = getComputedStyle(parent);
            const isLabelRow = parentStyle.display.includes('flex') && !parentStyle.flexDirection.startsWith('column') &&
                Array.from(parent.children).every(child => child === anchor || child.hasAttribute(ROW_ATTR) ||
                    (child.matches('span, .badge') && textWithoutBadge(child).length <= 24 &&
                        !child.querySelector('a, button') && !/(?:円|元|¥|￥)/.test(textWithoutBadge(child))));
            if (textWithoutBadge(parent) !== textWithoutBadge(anchor) && !isLabelRow) break;
            const outerStyle = parent.parentElement && getComputedStyle(parent.parentElement);
            if (outerStyle?.display.includes('flex') && !outerStyle.flexDirection.startsWith('column')) break;
            anchor = parent;
        }
        const parentStyle = anchor.parentElement && getComputedStyle(anchor.parentElement);
        // 没有安全的纵向插入点时，跳过，避免破坏未知结构的横向列表。
        if (parentStyle?.display.includes('flex') && !parentStyle.flexDirection.startsWith('column')) return null;
        return anchor;
    };

    const collectPlacements = () => {
        const placements = new Map();
        if (/(^|\.)mgstage\.com$/i.test(location.hostname)) {
            document.querySelectorAll('p.price').forEach(price => {
                const item = price.closest('.carousel-2row-item, .rank-list-item, .rank-item, .item, .contents');
                const link = item?.querySelector('a[href*="/product/product_detail/"]');
                if (!link) return;
                const cid = new URL(link.href, location.origin).pathname.split('/').filter(Boolean).pop();
                if (cid) placements.set(price, cid);
            });
            return placements;
        }
        document.querySelectorAll(LINK_SELECTOR).forEach(link => {
            const rawCID = extractCID(link.href);
            if (!rawCID) return;
            const title = findTitle(link, rawCID);
            const anchor = title && findAnchor(title);
            if (anchor) placements.set(anchor, rawCID);
        });
        return placements;
    };

    const processTitles = () => {
        const placements = collectPlacements();
        for (const [anchor, row] of rows) {
            if (!anchor.isConnected || placements.get(anchor) !== row.getAttribute(ROW_ATTR)) {
                row.remove();
                rows.delete(anchor);
            }
        }
        for (const [anchor, rawCID] of placements) {
            let row = rows.get(anchor);
            if (!row) {
                row = createRow(rawCID);
                rows.set(anchor, row);
            }
            // 每个标题只有一行；网站重新渲染移除番号后可自动补回。
            if (anchor.nextElementSibling !== row) anchor.insertAdjacentElement('afterend', row);
        }
    };

    let pending = false;
    const schedule = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            processTitles();
        });
    };
    const observer = new MutationObserver(mutations => {
        // 忽略脚本自身的插入/复制提示，避免循环扫描。
        const relevant = mutations.some(mutation => {
            const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
            if (target?.closest(`[${ROW_ATTR}]`)) return false;
            if (mutation.type !== 'childList') return true;
            const changed = [...mutation.addedNodes, ...mutation.removedNodes];
            if (changed.some(node => node.nodeType !== Node.ELEMENT_NODE || !node.hasAttribute(ROW_ATTR))) return true;
            // 官网单独移除/移动番号时补回；脚本自己删除的行已从 Map 中清除。
            return Array.from(rows).some(([anchor, row]) => anchor.isConnected &&
                changed.includes(row) && anchor.nextElementSibling !== row);
        });
        if (relevant) schedule();
    });
    observer.observe(document, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['href'],
    });
    processTitles();
})();
