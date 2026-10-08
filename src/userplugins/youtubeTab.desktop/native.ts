/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, ipcMain, screen, session, type IpcMainInvokeEvent, type WebContents } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { isAllowedUrl, YT_HOME, YT_PARTITION } from "./allow";
import { importBrowserLogin } from "./cookies";

export type YtState = {
    url: string;
    title: string;
    canBack: boolean;
    canForward: boolean;
    loading: boolean;
    signedIn: boolean;
    error: string;
    opened: boolean;
};

type Geom = { x: number; y: number; width: number; height: number; };

const MIN_W = 320;
const MIN_H = 220;
const PAGE_ZOOM = 0.8;
const styledPages = new Set<number>();

const BAR_CSS = `
html{height:100%!important;margin:0!important;overflow:hidden!important;background:#0f0f0f!important}
body{position:fixed!important;top:48px!important;left:0!important;right:0!important;bottom:0!important;height:auto!important;width:auto!important;margin:0!important;overflow-x:hidden!important;overflow-y:auto!important;transform:translateZ(0)!important;background:#0f0f0f!important;overscroll-behavior:contain!important}
#vc-yt-bar{position:fixed!important;top:0!important;left:0!important;right:0!important;height:48px!important;z-index:2147483647!important;display:flex!important;align-items:center!important;gap:8px!important;padding:8px 8px 8px 12px!important;margin:0!important;box-sizing:border-box!important;background:#0f0f0f!important;color:#f1f1f1!important;border-bottom:1px solid rgba(255,255,255,.12)!important;font:13px/1.2 "Segoe UI Variable Text","Segoe UI",sans-serif!important;-webkit-app-region:no-drag!important;user-select:none!important;pointer-events:auto!important}
#vc-yt-brand{display:flex!important;align-items:center!important;gap:8px!important;height:32px!important;padding:0 8px 0 0!important;min-width:0!important;flex:0 0 auto!important;font-size:13px!important;font-weight:600!important;color:#fff!important;-webkit-app-region:drag!important;cursor:grab!important;pointer-events:auto!important}
#vc-yt-brand span{pointer-events:none!important}
#vc-yt-brand span:first-child{display:grid!important;place-items:center!important;width:18px!important;height:18px!important;color:#ff0033!important;font-size:11px!important;line-height:1!important}
#vc-yt-url,#vc-yt-go,#vc-yt-nav,#vc-yt-nav button,#vc-yt-wins,#vc-yt-wins button{-webkit-app-region:no-drag!important;pointer-events:auto!important;-webkit-appearance:none!important;appearance:none!important;box-shadow:none!important}
#vc-yt-nav{display:flex!important;align-items:center!important;gap:2px!important;flex:0 0 auto!important;height:32px!important}
#vc-yt-nav button{width:32px!important;height:32px!important;min-width:32px!important;flex:0 0 32px!important;margin:0!important;padding:0!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#f1f1f1!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important}
#vc-yt-nav button svg{display:block!important;width:16px!important;height:16px!important;pointer-events:none!important}
#vc-yt-nav button:hover,#vc-yt-nav button:focus-visible{background:rgba(255,255,255,.1)!important}
#vc-yt-nav button:active{background:rgba(255,255,255,.16)!important}
#vc-yt-nav button:disabled{opacity:.38!important;cursor:default!important;background:transparent!important}
#vc-yt-nav button:disabled:hover{background:transparent!important}
#vc-yt-url{flex:1 1 auto!important;min-width:0!important;width:auto!important;height:32px!important;margin:0!important;padding:0 12px!important;border:0!important;border-radius:8px!important;background:#272727!important;color:#f1f1f1!important;outline:none!important;font:inherit!important;font-size:12px!important}
#vc-yt-url::placeholder{color:#aaa!important}
#vc-yt-url:hover{background:#3a3a3a!important}
#vc-yt-url:focus{background:#1a1a1a!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)!important}
#vc-yt-go{flex:0 0 auto!important;height:32px!important;margin:0!important;padding:0 14px!important;border:0!important;border-radius:8px!important;background:#f1f1f1!important;color:#0f0f0f!important;cursor:pointer!important;font:inherit!important;font-size:12px!important;font-weight:600!important;white-space:nowrap!important}
#vc-yt-go:hover,#vc-yt-go:focus-visible{background:#fff!important}
#vc-yt-go:active{background:#e5e5e5!important}
#vc-yt-wins{display:flex!important;align-items:center!important;gap:2px!important;height:32px!important;margin:0 0 0 4px!important;flex:0 0 auto!important}
#vc-yt-wins button{width:36px!important;height:32px!important;margin:0!important;padding:0!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#f1f1f1!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;flex:0 0 auto!important}
#vc-yt-wins button svg{display:block!important;pointer-events:none!important}
#vc-yt-wins button:hover,#vc-yt-wins button:focus-visible{background:rgba(255,255,255,.1)!important}
#vc-yt-wins button:active{background:rgba(255,255,255,.16)!important}
#vc-yt-wins button[data-act="close"]:hover,#vc-yt-wins button[data-act="close"]:focus-visible{background:#e81123!important;color:#fff!important}
#vc-yt-wins button[data-act="close"]:active{background:#c50f1f!important}
@media (max-width:560px){#vc-yt-brand span:last-child{display:none!important}#vc-yt-bar{padding-left:10px!important;gap:6px!important}}
@media (max-width:420px){#vc-yt-go{padding:0 10px!important}#vc-yt-wins button{width:32px!important}}
html.vc-yt-fs #vc-yt-bar{display:none!important}
html.vc-yt-fs body{top:0!important;transform:none!important;overflow:hidden!important}
body > ytd-app,body ytd-app{position:relative!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;width:100%!important;height:auto!important;max-height:none!important;min-height:100%!important;overflow:visible!important}
ytd-page-manager,#page-manager{height:auto!important;max-height:none!important;overflow:visible!important}
`;

let shell: BrowserWindow | null = null;
let host: BrowserWindow | null = null;
let wanted = false;
let fullscreen = false;
let minimized = false;
let maxed = false;
let restored: Geom | null = null;
let chain: Promise<void> = Promise.resolve();
let lastError = "";
let signedIn = false;
let signedAt = 0;
let wired = false;
let ipcReady = false;
let unwatchHost: (() => void) | null = null;

function normalizePaste(raw: string) {
    let text = String(raw || "").trim();
    if (!text) return "";
    if (!/^https?:\/\//i.test(text)) {
        if (/^(?:www\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com|m\.youtube\.com)\b/i.test(text)) text = "https://" + text;
        else if (/^[a-zA-Z0-9_-]{11}$/.test(text)) text = "https://www.youtube.com/watch?v=" + text;
        else if (/^[\w.-]+\.[a-z]{2,}([/?#]|$)/i.test(text)) text = "https://" + text;
        else return "";
    }
    try {
        const url = new URL(text);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        return url.toString();
    } catch {
        return "";
    }
}

function canNavigate(raw: string) {
    if (!raw || raw === "about:blank") return true;
    try {
        const url = new URL(raw);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function chromeUa() {
    const chrome = process.versions.chrome || "131.0.0.0";
    if (process.platform === "darwin")
        return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
    if (process.platform === "linux")
        return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function ytSession() {
    return session.fromPartition(YT_PARTITION);
}

function geomFile() {
    return join(app.getPath("userData"), "vc-youtube-window.json");
}

function readGeom(): Geom | null {
    try {
        const raw = JSON.parse(readFileSync(geomFile(), "utf8")) as Geom;
        if (!raw || raw.width < MIN_W || raw.height < MIN_H) return null;
        return {
            x: Math.round(raw.x),
            y: Math.round(raw.y),
            width: Math.round(raw.width),
            height: Math.round(raw.height)
        };
    } catch {
        return null;
    }
}

function saveGeom() {
    const win = liveShell();
    if (!win || minimized || maxed || fullscreen) return;
    const b = win.getBounds();
    if (b.width < MIN_W || b.height < MIN_H) return;
    try {
        const dir = app.getPath("userData");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(geomFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }));
    } catch { /* ignore */ }
}

function hostWindow(ipc: IpcMainInvokeEvent) {
    const win = BrowserWindow.fromWebContents(ipc.sender);
    return win && !win.isDestroyed() ? win : null;
}

function liveShell() {
    return shell && !shell.isDestroyed() ? shell : null;
}

function clampGeom(geom: Geom): Geom {
    const area = screen.getDisplayMatching({
        x: geom.x,
        y: geom.y,
        width: geom.width,
        height: geom.height
    }).workArea;
    const width = Math.min(Math.max(MIN_W, geom.width), Math.max(MIN_W, area.width - 16));
    const height = Math.min(Math.max(MIN_H, geom.height), Math.max(MIN_H, area.height - 16));
    return {
        x: Math.min(Math.max(area.x, geom.x), area.x + area.width - width),
        y: Math.min(Math.max(area.y, geom.y), area.y + area.height - height),
        width,
        height
    };
}

function defaultGeom(parent: BrowserWindow): Geom {
    const area = parent.getContentBounds();
    const width = Math.min(560, Math.max(MIN_W, Math.round(area.width * 0.42)));
    const height = Math.min(420, Math.max(MIN_H, Math.round(area.height * 0.46)));
    return {
        x: Math.round(area.x + area.width - width - 24),
        y: Math.round(area.y + area.height - height - 48),
        width,
        height
    };
}

function writePreload() {
    const file = join(app.getPath("userData"), "vc-youtube-chrome-preload.js");
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, `"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("vcyt", {
  act: function (name) { ipcRenderer.send("vc-youtube-act", String(name || "")); },
  open: function (url) { ipcRenderer.send("vc-youtube-open", String(url || "")); }
});
`);
    return file;
}

function wireIpc() {
    if (ipcReady) return;
    ipcReady = true;
    ipcMain.on("vc-youtube-act", (event, name: string) => {
        const win = liveShell();
        if (!win || event.sender !== win.webContents) return;
        if (name === "close") {
            wanted = false;
            destroyShell();
            return;
        }
        if (name === "min") applyMin(!minimized);
        else if (name === "max") toggleMax();
        else if (name === "back" && canGo(win.webContents, "back")) win.webContents.goBack();
        else if (name === "forward" && canGo(win.webContents, "forward")) win.webContents.goForward();
        else if (name === "signout") void clearLogin();
    });
    ipcMain.on("vc-youtube-open", (event, raw: string) => {
        const win = liveShell();
        if (!win || event.sender !== win.webContents) return;
        const url = normalizePaste(raw);
        if (!url) return;
        lastError = "";
        void win.loadURL(url).catch(() => {
            lastError = "Couldn't open that link.";
        });
    });
}

function wireSession() {
    if (wired) return;
    wired = true;
    const ses = ytSession();
    const ua = chromeUa();
    const major = (process.versions.chrome || "131.0.0.0").split(".")[0];
    const platform = process.platform === "darwin" ? "macOS" : process.platform === "linux" ? "Linux" : "Windows";
    ses.setUserAgent(ua);
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(permission === "fullscreen" || permission === "clipboard-sanitized-write" || permission === "media");
    });
    ses.webRequest.onBeforeSendHeaders({ urls: ["*://*/*"] }, (details, callback) => {
        try {
            const headers = details.requestHeaders;
            headers["User-Agent"] = ua;
            headers["Sec-CH-UA"] = `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not.A/Brand";v="24"`;
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = `"${platform}"`;
            callback({ requestHeaders: headers });
        } catch {
            callback({ requestHeaders: details.requestHeaders });
        }
    });
}

function ensureBarCss(wc: WebContents) {
    if (styledPages.has(wc.id)) return;
    styledPages.add(wc.id);
    void (async () => {
        try {
            await wc.insertCSS(BAR_CSS, { cssOrigin: "user" });
        } catch {
            try {
                await wc.insertCSS(BAR_CSS);
            } catch {
                styledPages.delete(wc.id);
            }
        }
    })();
}

function fitPage(wc: WebContents) {
    if (!wc || wc.isDestroyed()) return;
    try { wc.setZoomFactor(PAGE_ZOOM); } catch { /* ignore */ }
}

function paintBar(wc: WebContents) {
    if (!wc || wc.isDestroyed()) return;
    fitPage(wc);
    ensureBarCss(wc);
    const current = JSON.stringify(wc.getURL() || "");
    const maximized = liveShell()?.isMaximized() === true;
    const canBack = canGo(wc, "back");
    const canForward = canGo(wc, "forward");
    const script = `(function(current, maximized, canBack, canForward){
      var NS = "http://www.w3.org/2000/svg";
      function node(tag, parent, attrs) {
        var el = document.createElement(tag);
        if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(el);
        return el;
      }
      function glyph(parent, d) {
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("width", "12");
        svg.setAttribute("height", "12");
        svg.setAttribute("viewBox", "0 0 10 10");
        var path = document.createElementNS(NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "1.15");
        svg.appendChild(path);
        parent.appendChild(svg);
      }
      function arrow(parent, d) {
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("viewBox", "0 0 16 16");
        var path = document.createElementNS(NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "1.6");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.appendChild(path);
        parent.appendChild(svg);
      }
      var press = function(el, fn){
        el.addEventListener("pointerdown", function(e){
          if (e.button !== 0 || el.disabled) return;
          e.preventDefault();
          e.stopPropagation();
          fn();
        }, true);
      };
      function ensureNav(bar) {
        var nav = document.getElementById("vc-yt-nav");
        if (nav) return nav;
        nav = node("div", null, { id: "vc-yt-nav", style: "-webkit-app-region:no-drag" });
        var backBtn = node("button", nav, { id: "vc-yt-back", type: "button", "data-act": "back", "aria-label": "Back", style: "-webkit-app-region:no-drag" });
        arrow(backBtn, "M10 3L5 8l5 5");
        var fwdBtn = node("button", nav, { id: "vc-yt-fwd", type: "button", "data-act": "forward", "aria-label": "Forward", style: "-webkit-app-region:no-drag" });
        arrow(fwdBtn, "M6 3l5 5-5 5");
        var brand = document.getElementById("vc-yt-brand");
        if (brand && brand.parentNode === bar) brand.insertAdjacentElement("afterend", nav);
        else bar.insertBefore(nav, bar.firstChild);
        press(backBtn, function(){ if (window.vcyt) window.vcyt.act("back"); });
        press(fwdBtn, function(){ if (window.vcyt) window.vcyt.act("forward"); });
        return nav;
      }
      var bar = document.getElementById("vc-yt-bar");
      if (!bar) {
        bar = node("div", null, { id: "vc-yt-bar" });
        var brand = node("div", bar, { id: "vc-yt-brand", style: "-webkit-app-region:drag" });
        var mark = node("span", brand, { "aria-hidden": "true" });
        mark.textContent = "\\u25B6";
        mark.style.color = "#ff0033";
        node("span", brand).textContent = "YouTube";
        var input = node("input", bar, { id: "vc-yt-url", placeholder: "Paste a link", spellcheck: "false", autocomplete: "off", style: "-webkit-app-region:no-drag" });
        var goBtn = node("button", bar, { id: "vc-yt-go", type: "button", style: "-webkit-app-region:no-drag" });
        goBtn.textContent = "Watch";
        var wins = node("div", bar, { id: "vc-yt-wins", style: "-webkit-app-region:no-drag" });
        var minBtn = node("button", wins, { type: "button", "data-act": "min", "aria-label": "Minimize", style: "-webkit-app-region:no-drag" });
        glyph(minBtn, "M0 5h10");
        node("button", wins, { type: "button", "data-act": "max", "aria-label": "Maximize", style: "-webkit-app-region:no-drag" });
        var closeBtn = node("button", wins, { type: "button", "data-act": "close", "aria-label": "Close", style: "-webkit-app-region:no-drag" });
        glyph(closeBtn, "M1 1l8 8M9 1L1 9");
        var go = function(){ if (window.vcyt && input.value) window.vcyt.open(input.value); };
        press(goBtn, go);
        input.addEventListener("keydown", function(e){ if (e.key === "Enter") { e.preventDefault(); go(); } });
        bar.querySelectorAll("[data-act]").forEach(function(btn){
          press(btn, function(){ if (window.vcyt) window.vcyt.act(btn.getAttribute("data-act")); });
        });
        if (!window.__vcYtWatch) {
          window.__vcYtWatch = new MutationObserver(function(){
            var live = document.getElementById("vc-yt-bar");
            if (live && live.parentNode !== document.documentElement) document.documentElement.appendChild(live);
          });
          window.__vcYtWatch.observe(document.documentElement, { childList: true });
        }
        if (!window.__vcYtFs) {
          window.__vcYtFs = true;
          document.addEventListener("fullscreenchange", function(){
            document.documentElement.classList.toggle("vc-yt-fs", !!document.fullscreenElement);
          });
        }
        if (!window.__vcYtScroll) {
          window.__vcYtScroll = true;
          var canScrollY = function(el){
            var box = getComputedStyle(el);
            var oy = box.overflowY;
            return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1;
          };
          window.addEventListener("wheel", function(e){
            if (e.ctrlKey || document.fullscreenElement) return;
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            var node = e.target;
            while (node && node !== document.body && node !== document.documentElement) {
              if (node.nodeType === 1 && canScrollY(node)) return;
              node = node.parentElement;
            }
            var page = document.body;
            if (!page) return;
            var max = page.scrollHeight - page.clientHeight;
            if (max <= 0) return;
            var next = page.scrollTop + e.deltaY;
            if (next < 0) next = 0;
            if (next > max) next = max;
            if (next === page.scrollTop) return;
            page.scrollTop = next;
            e.preventDefault();
          }, { capture: true, passive: false });
        }
      }
      ensureNav(bar);
      var backBtn = document.getElementById("vc-yt-back");
      var fwdBtn = document.getElementById("vc-yt-fwd");
      if (backBtn) backBtn.disabled = !canBack;
      if (fwdBtn) fwdBtn.disabled = !canForward;
      var staleOut = document.getElementById("vc-yt-out");
      if (staleOut) staleOut.remove();
      document.documentElement.appendChild(bar);
      var page = document.body;
      if (page && !document.fullscreenElement) {
        page.style.setProperty("position", "fixed", "important");
        page.style.setProperty("top", "48px", "important");
        page.style.setProperty("right", "0", "important");
        page.style.setProperty("bottom", "0", "important");
        page.style.setProperty("left", "0", "important");
        page.style.setProperty("transform", "translateZ(0)", "important");
        page.style.setProperty("overflow-x", "hidden", "important");
        page.style.setProperty("overflow-y", "auto", "important");
      }
      var maxBtn = bar.querySelector('[data-act="max"]');
      if (maxBtn) {
        while (maxBtn.firstChild) maxBtn.removeChild(maxBtn.firstChild);
        glyph(maxBtn, maximized ? "M2 2h6v6H2zM3 2V1h6v6H8" : "M0.5 0.5h9v9h-9z");
      }
      var field = document.getElementById("vc-yt-url");
      if (field && document.activeElement !== field && current && current.indexOf("data:") !== 0) field.value = current;
    })(${current}, ${maximized}, ${canBack}, ${canForward})`;
    void wc.executeJavaScript(script, true).catch(() => 0);
}

function wirePage(wc: WebContents, parent: BrowserWindow) {
    wc.setUserAgent(chromeUa());
    wc.setBackgroundThrottling(false);
    fitPage(wc);
    wc.setWindowOpenHandler(({ url }) => {
        if (canNavigate(url) && !wc.isDestroyed()) void wc.loadURL(url).catch(() => 0);
        return { action: "deny" };
    });
    const guard = (event: Electron.Event, url: string) => {
        if (typeof url !== "string" || !url || canNavigate(url) || isAllowedUrl(url)) return;
        event.preventDefault();
    };
    wc.on("will-navigate", guard);
    wc.on("will-redirect", guard);
    wc.on("did-navigate", () => {
        styledPages.delete(wc.id);
        signedAt = 0;
        lastError = "";
    });
    wc.on("did-fail-load", (_event, code, desc, _url, isMain) => {
        if (!isMain || code === -3) return;
        lastError = desc || "Couldn't load YouTube.";
    });
    wc.on("dom-ready", () => paintBar(wc));
    wc.on("did-finish-load", () => {
        lastError = "";
        paintBar(wc);
    });
    wc.on("did-navigate-in-page", () => paintBar(wc));
    wc.on("enter-html-full-screen", () => {
        const win = liveShell();
        if (!win) return;
        fullscreen = true;
        restored = win.getBounds();
        win.setBounds(parent.getContentBounds());
    });
    wc.on("leave-html-full-screen", () => {
        fullscreen = false;
        const win = liveShell();
        if (win && restored) win.setBounds(clampGeom(restored));
        restored = null;
    });
}

function watchHost(parent: BrowserWindow) {
    unwatchHost?.();
    const hide = () => {
        try { liveShell()?.hide(); } catch { /* ignore */ }
    };
    const show = () => {
        const current = liveShell();
        if (!wanted || !current || minimized) return;
        try {
            current.showInactive();
            current.moveTop();
        } catch { /* ignore */ }
    };
    const raise = () => {
        const current = liveShell();
        if (!wanted || !current || !current.isVisible() || current.isMinimized()) return;
        try { current.moveTop(); } catch { /* ignore */ }
    };
    parent.on("minimize", hide);
    parent.on("hide", hide);
    parent.on("restore", show);
    parent.on("show", show);
    parent.on("focus", raise);
    unwatchHost = () => {
        parent.off("minimize", hide);
        parent.off("hide", hide);
        parent.off("restore", show);
        parent.off("show", show);
        parent.off("focus", raise);
        unwatchHost = null;
    };
}

function destroyShell() {
    saveGeom();
    unwatchHost?.();
    const current = shell;
    shell = null;
    fullscreen = false;
    minimized = false;
    maxed = false;
    if (current && !current.isDestroyed()) {
        try { current.destroy(); } catch { /* ignore */ }
    }
}

function ensureShell(parent: BrowserWindow) {
    const current = liveShell();
    if (current) {
        host = parent;
        watchHost(parent);
        return current;
    }
    wireSession();
    wireIpc();
    host = parent;
    const preload = writePreload();
    const geom = clampGeom(readGeom() || defaultGeom(parent));
    shell = new BrowserWindow({
        x: geom.x,
        y: geom.y,
        width: geom.width,
        height: geom.height,
        minWidth: MIN_W,
        minHeight: MIN_H,
        frame: false,
        show: false,
        skipTaskbar: false,
        movable: true,
        resizable: true,
        minimizable: true,
        maximizable: true,
        closable: true,
        fullscreenable: false,
        focusable: true,
        hasShadow: true,
        backgroundColor: "#0f0f0f",
        autoHideMenuBar: true,
        webPreferences: {
            preload,
            partition: YT_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            spellcheck: false,
            zoomFactor: PAGE_ZOOM
        }
    });
    const win = shell;
    try { win.setMenu(null); } catch { /* ignore */ }
    try { win.setMenuBarVisibility(false); } catch { /* ignore */ }
    try { win.setMovable(true); } catch { /* ignore */ }
    win.on("page-title-updated", event => event.preventDefault());
    wirePage(win.webContents, parent);
    win.on("resized", () => {
        saveGeom();
    });
    win.on("moved", saveGeom);
    win.on("maximize", () => {
        maxed = true;
        paintBar(win.webContents);
    });
    win.on("unmaximize", () => {
        maxed = false;
        paintBar(win.webContents);
    });
    win.on("minimize", () => { minimized = true; });
    win.on("restore", () => {
        minimized = false;
        paintBar(win.webContents);
    });
    win.on("closed", () => {
        if (shell !== win) return;
        shell = null;
        wanted = false;
        minimized = false;
        maxed = false;
        fullscreen = false;
    });
    void win.loadURL(YT_HOME).catch(err => {
        const msg = err instanceof Error ? err.message : "";
        if (!wanted || msg.includes("ERR_ABORTED")) return;
        lastError = "Couldn't open that page.";
    });
    watchHost(parent);
    win.show();
    return win;
}

function applyMin(on: boolean) {
    const win = liveShell();
    if (!win) return;
    if (on) {
        minimized = true;
        win.minimize();
    } else if (win.isMinimized()) {
        minimized = false;
        win.restore();
    }
}

function toggleMax() {
    const win = liveShell();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (win.isMaximized()) {
        maxed = false;
        win.unmaximize();
    } else {
        maxed = true;
        win.maximize();
    }
}

function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const run = chain.then(task);
    chain = run.then(() => undefined, () => undefined);
    return run;
}

function canGo(wc: WebContents | null, dir: "back" | "forward") {
    if (!wc || wc.isDestroyed()) return false;
    try {
        if (dir === "back" && typeof wc.canGoBack === "function") return wc.canGoBack();
        if (dir === "forward" && typeof wc.canGoForward === "function") return wc.canGoForward();
    } catch { /* ignore */ }
    return false;
}

async function readSignedIn(force = false) {
    const now = Date.now();
    if (!force && now - signedAt < 5000) return signedIn;
    signedAt = now;
    try {
        const login = await ytSession().cookies.get({ name: "LOGIN_INFO" });
        signedIn = login.some(cookie => cookie.domain?.includes("youtube"));
        if (!signedIn) {
            const sid = await ytSession().cookies.get({ domain: ".youtube.com", name: "SAPISID" });
            signedIn = sid.length > 0;
        }
    } catch {
        signedIn = false;
    }
    return signedIn;
}

async function clearLogin() {
    try {
        await ytSession().clearStorageData();
    } catch { /* ignore */ }
    signedIn = false;
    signedAt = 0;
    lastError = "";
    const wc = liveShell()?.webContents;
    if (wc && !wc.isDestroyed() && wanted) void wc.loadURL(YT_HOME).catch(() => 0);
}

export function open(ipc: IpcMainInvokeEvent) {
    return enqueue(() => {
        const parent = hostWindow(ipc);
        if (!parent) return { ok: false as const, message: "YouTube couldn't attach to the Discord window." };
        wanted = true;
        lastError = "";
        minimized = false;
        try {
            const win = ensureShell(parent);
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
            return { ok: true as const, message: "" };
        } catch (err) {
            lastError = err instanceof Error ? err.message : "Couldn't open YouTube.";
            return { ok: false as const, message: lastError };
        }
    });
}

export function home(ipc: IpcMainInvokeEvent) {
    return open(ipc);
}

export function setBounds(_ipc: IpcMainInvokeEvent) {
    return Promise.resolve();
}

export async function getState(_ipc: IpcMainInvokeEvent): Promise<YtState> {
    const wc = liveShell()?.webContents;
    const live = wc && !wc.isDestroyed() ? wc : null;
    return {
        url: live?.getURL() || "",
        title: live?.getTitle() || "",
        canBack: canGo(live, "back"),
        canForward: canGo(live, "forward"),
        loading: live?.isLoading() || false,
        signedIn: await readSignedIn(),
        error: lastError,
        opened: wanted && !!liveShell()
    };
}

export async function importBrowserCookies(_ipc: IpcMainInvokeEvent) {
    let result: { ok: boolean; message: string; };
    try {
        result = await importBrowserLogin(YT_PARTITION);
    } catch (err) {
        console.error("[YouTubeTab] browser login failed:", err instanceof Error ? err.message : "error");
        result = { ok: false, message: "Couldn't read the browser login. Sign in inside the window instead." };
    }
    signedAt = 0;
    return result;
}

export function signOut(_ipc: IpcMainInvokeEvent) {
    return enqueue(async () => {
        await clearLogin();
        return { ok: true as const };
    });
}

export function close(ipc: IpcMainInvokeEvent) {
    return enqueue(() => {
        wanted = false;
        fullscreen = false;
        lastError = "";
        const win = hostWindow(ipc);
        if (win) host = win;
        destroyShell();
    });
}
