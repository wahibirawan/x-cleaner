# X Cleaner (v1.1.0)

Clean up your X (formerly Twitter) profile. Wipe your posts, reposts, and likes instantly. 

X Cleaner is a lightweight, privacy-focused Chrome extension designed to automate the process of cleaning up your profile page. Built entirely on vanilla JavaScript and CSS, it mimics natural user behavior to safely remove your content.

---

## 🌟 Key Features

*   **Two Specialized Modes**:
    *   **Delete Mode**: Removes your own posts. Includes an optional toggle to **Undo Reposts** (retweets) to clean your timeline of other users' content you shared.
    *   **Unlike Mode**: Automates unliking tweets, helping you clear your likes tab.
*   **Batch & Cooldown Engine**:
    *   Processes items in custom batches (1 to 50 items, default is 5) to mimic realistic intervals.
    *   Allows customizable cooldown timers (in milliseconds) between batches to prevent triggering X's anti-spam or rate-limiting systems.
*   **Smart Scroll & Alignment**:
    *   Uses dynamic scrolling (`scrollIntoView`) to center the targeted post before interaction, solving layout overlaps and ensuring visual consistency.
    *   Smoothly scrolls the timeline downward to fetch new items when the active queue is cleared.
*   **Unified Activity & Status Bar**:
    *   Displays a real-time status indicator (Gray: Idle, Green: Running, Orange: Paused, Red: Error).
    *   Includes a live stopwatch timer showing elapsed duration (`MM:SS`) and active batch status inside a compact, premium iOS-style header.
*   **Robust Error Handling & Auto-Pause**:
    *   Monitors consecutive failures (such as dialogs failing to open or load).
    *   If **3 consecutive errors** occur, the extension automatically pauses the task and slides down an interactive, user-friendly notification banner directly on the active X.com page with options to **Coba Lagi (Retry)** or **Berhenti (Stop)**.

---

## 📱 User Interface (iOS Style)

The interface has been redesigned to be compact and elegant:
*   **Segmented Mode Controls**: Seamlessly switch between **Delete** and **Unlike** modes.
*   **Collapsible Settings Panel**: Dynamically displays options like *Undo Reposts* only when relevant.
*   **Quick Guide Full-Sheet**: An in-app guide accessible at any time via the Help icon (`?`) in the navbar.

---

## 📖 How It Works

For the extension to target the correct items, you must be on the appropriate tab of your X profile:

### 1. To Delete Your Posts & Reposts
1.  Navigate to **[x.com](https://x.com)** and go to your **X Profile**.
2.  Select the **Posts** tab.
3.  Open the **X Cleaner** extension from your browser toolbar.
4.  Set the mode to **Delete**.
5.  *(Optional)* Toggle **Undo Reposts** to also remove retweets.
6.  Click **Start Cleaning**.

### 2. To Remove Your Likes
1.  Navigate to **[x.com](https://x.com)** and go to your **X Profile**.
2.  Select the **Likes** tab.
3.  Open the **X Cleaner** extension from your browser toolbar.
4.  Set the mode to **Unlike**.
5.  Click **Start Cleaning**.

> [!TIP]
> Keep the browser tab active and in view during cleaning. If X's servers become unresponsive, the script will pause and prompt you with a notification banner at the top of your page.

---

## 🛠️ Installation Instructions

Since this extension is run locally, install it via Chrome Developer Mode:

1.  Clone or download this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** using the toggle switch in the top-right corner.
4.  Click **Load unpacked** in the top-left corner.
5.  Select the project root directory (the folder containing `manifest.json`).
6.  Pin **X Cleaner** to your browser toolbar for quick access.

---

## 🔒 Privacy Policy

*   **100% Local Execution**: All extraction, navigation, and deletion processes occur directly in your local browser window.
*   **Zero External Requests**: The extension does not communicate with external servers, databases, or third-party APIs.
*   **No Data Collection**: No cookies, session info, credentials, analytics, or browsing habits are recorded or shared.

---

## 📄 License

This project is licensed under the MIT License. You are free to use, modify, and distribute the code under the terms of the license.
