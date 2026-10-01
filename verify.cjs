const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const OUT_DIR = "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\e--s15-Projects-ceo-agent\\afbce2d3-8cc9-40d5-a2c0-926a8f2b092a\\scratchpad";

const BYPASS_AUTH = `
  state.auth = {
    loading: false,
    user: { name: "Test User", email: "test@test.com", organizationId: "org1", organizationName: "Test Org" },
    mode: null,
  };
  state.analytics = {
    totals: { totalRuns: 0, successRuns: 0, errorRuns: 0, runningRuns: 0, totalDocuments: 0 },
    runsByDepartment: [],
    recentDocuments: [],
    recentErrors: [],
  };
  state.runs = [];
  render();
  "ok";
`;

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, name), img.toPNG());
  console.log("SAVED", name);
}

async function checkOverflow(win) {
  return win.webContents.executeJavaScript(`
    (function() {
      const actions = document.querySelector(".header-actions");
      const header = document.querySelector(".app-header");
      if (!actions || !header) return { error: "not found" };
      const a = actions.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        headerRight: h.right,
        actionsRight: a.right,
        actionsLeft: a.left,
        overflowsViewport: a.right > window.innerWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })();
  `);
}

async function run() {
  const errors = [];
  const win = new BrowserWindow({
    width: 375,
    height: 812,
    show: false,
    webPreferences: { devTools: false },
  });
  win.webContents.on("console-message", (e, level, message) => {
    if (level >= 2) errors.push(message);
  });

  await win.loadURL("http://localhost:3100");
  await new Promise((r) => setTimeout(r, 1500));
  await win.webContents.executeJavaScript(BYPASS_AUTH);
  await new Promise((r) => setTimeout(r, 500));

  // ---- Mobile (375x812) ----
  win.setContentSize(375, 812);
  await new Promise((r) => setTimeout(r, 400));
  await shot(win, "mobile-1-overview.png");
  const overflowMobile = await checkOverflow(win);
  console.log("MOBILE_OVERFLOW", JSON.stringify(overflowMobile));

  // Tap playbook menu button
  await win.webContents.executeJavaScript(`document.getElementById("playbook-menu-btn")?.click(); "clicked";`);
  await new Promise((r) => setTimeout(r, 300));
  await shot(win, "mobile-2-playbook-popover.png");
  const playbookOpen = await win.webContents.executeJavaScript(
    `!!document.querySelector(".playbook-menu.open .playbook-menu-popover")`,
  );
  console.log("PLAYBOOK_POPOVER_OPEN_VIA_TAP", playbookOpen);
  // close it (click elsewhere)
  await win.webContents.executeJavaScript(`document.body.click(); "closed";`);
  await new Promise((r) => setTimeout(r, 200));

  // Tap account avatar
  await win.webContents.executeJavaScript(`document.getElementById("account-menu-btn")?.click(); "clicked";`);
  await new Promise((r) => setTimeout(r, 300));
  await shot(win, "mobile-3-account-popover.png");
  const accountOpen = await win.webContents.executeJavaScript(
    `!!document.querySelector(".header-account.open .account-popover")`,
  );
  console.log("ACCOUNT_POPOVER_OPEN_VIA_TAP", accountOpen);
  await win.webContents.executeJavaScript(`document.body.click(); "closed";`);
  await new Promise((r) => setTimeout(r, 200));

  // Open hamburger sidebar drawer
  await win.webContents.executeJavaScript(`document.getElementById("sidebar-toggle")?.click(); "clicked";`);
  await new Promise((r) => setTimeout(r, 400));
  await shot(win, "mobile-4-sidebar-drawer.png");
  const navLinksInSidebar = await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll(".sidebar-nav-link")).map(b => b.textContent.trim())`,
  );
  console.log("SIDEBAR_NAV_LINKS_MOBILE", JSON.stringify(navLinksInSidebar));

  // ---- Tablet (800x1024) ----
  win.setContentSize(800, 1024);
  await new Promise((r) => setTimeout(r, 500));
  await shot(win, "tablet-1-overview.png");
  const navLinksTablet = await win.webContents.executeJavaScript(
    `({
      sidebarNavLinks: Array.from(document.querySelectorAll(".sidebar-nav-link")).map(b => b.textContent.trim()),
      headerMenuVisible: getComputedStyle(document.querySelector(".header-menu")).display !== "none",
      headerMenuLinks: Array.from(document.querySelectorAll(".header-menu-link")).map(b => b.textContent.trim()),
    })`,
  );
  console.log("TABLET_NAV", JSON.stringify(navLinksTablet));
  const overflowTablet = await checkOverflow(win);
  console.log("TABLET_OVERFLOW", JSON.stringify(overflowTablet));

  // ---- Desktop (1440x900) ----
  win.setContentSize(1440, 900);
  await new Promise((r) => setTimeout(r, 500));
  await shot(win, "desktop-1-overview.png");
  const desktopNav = await win.webContents.executeJavaScript(
    `({
      headerMenuVisible: getComputedStyle(document.querySelector(".header-menu")).display !== "none",
      headerMenuLinks: Array.from(document.querySelectorAll(".header-menu-link")).map(b => b.textContent.trim()),
      hamburgerVisible: !!document.getElementById("sidebar-toggle"),
    })`,
  );
  console.log("DESKTOP_NAV", JSON.stringify(desktopNav));
  const overflowDesktop = await checkOverflow(win);
  console.log("DESKTOP_OVERFLOW", JSON.stringify(overflowDesktop));

  console.log("CONSOLE_ERRORS", JSON.stringify(errors));
  win.close();
  app.quit();
}

app.whenReady().then(run);
