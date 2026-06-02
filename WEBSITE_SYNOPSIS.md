# MEDIMATE: Integrated Ecosystem Synopsis
**Smart Medicine Segregation & Caregiver Cloud Interface**

---

## 1. Executive Summary
Medimate is a dual-layered healthcare solution comprising a physical IoT appliance and a high-performance web dashboard. While the hardware ensures physical adherence through automation (servos/LEDs), the website acts as the "brain" for caregivers, providing real-time oversight, remote emergency management, and data-driven compliance tracking.

---

## 2. The Web Dashboard: Core Functions

### A. Real-Time Adherence Monitoring (Bento Interface)
*   **Live Regimen Tracking:** A dynamic "Daily Regimen" list that updates instantly when doses are taken or missed.
*   **Compliance Analytics:** A visual progress engine (circular percentage tracker) that calculates successful medication adherence for the current 24-hour cycle.
*   **Next-Dose Countdown:** A high-visibility "Hero Card" that identifies the exact time and label of the upcoming dosage.

### B. Intelligent Event Logging (Live Feed)
*   **Hardware Traceability:** Every action taken by the ESP32 (Lid opened, Button pressed, Sensor trigger) is time-stamped and logged in a scrollable, high-contrast feed.
*   **Event Categorization:** Uses color-coded signals (Red: Alert/Panic, Green: Success, Amber: Warning) for rapid visual scanning by caregivers.

### C. Emergency Command & Control
*   **High-Stakes Overlay:** A full-screen, motion-enabled emergency interceptor that triggers globally across all connected dashboards if the hardware's panic button is pressed.
*   **Remote Override:** Caregivers can manually mark doses as "Taken" or "Missed" from the web interface to sync state with the physical appliance.

### D. Hardware Simulation Hub (Developer Sandbox)
*   Provides a suite of tools to simulate hardware events (Battery Loss, Sensor Failure, Alarm Trigger) for system testing without needing the physical ESP32 connected.

---

## 3. Hardware-Software Integration (The IoT Bridge)

The synergy between the web platform and your ESP32 is managed via a **Unified API Layer**:

| Hardware Action (ESP32) | Website Reaction |
| :--- | :--- |
| **RTC Match (Med Time)** | Dashboard highlights the dose; status changes to "Pending". |
| **Servo Lid Lifts** | Log entry: "Compartment Lid Opened"; LED status active on UI. |
| **Panic Button Pressed** | Triggers the Full-Screen Red Emergency Overlay on the web. |
| **Dose Collected (Sensor/Button)** | Database updates result; Compliance % increases on UI. |

### Technical Workflow:
1.  **Communication Protocol:** The ESP32 uses HTTP POST requests to send event data to the server.
2.  **State Management:** The server persists schedules and logs.
3.  **Instant Delivery:** Using **WebSockets (Socket.io)**, changes are pushed to the website in milliseconds without requiring a page refresh.

---

## 4. Future Roadmap & AI Integration

### I. Gemini Virtual Medical Advisor
An integrated AI chat interface utilizing the Gemini 1.5 Flash model to:
*   Answer patient queries about specific prescriptions.
*   Advise on side effects or food-drug interactions (e.g., "Before/After Meal" guidance).

### II. Computer Vision Prescription Scanner
A "Upload & Sync" feature allowing users to photograph a paper prescription. The system will:
1.  Extract medicine names and timings using OCR.
2.  Automatically populate the "Daily Regimen" on the dashboard.
3.  Transmit new schedules to the ESP32's memory.

### III. Notification Escalation
Expanding the "Cloud Alert" to external channels:
*   **Primary:** Web Push Notifications.
*   **Secondary:** Automated WhatsApp/Telegram alerts for prolonged medication delays.

---
**Developers:** Aditya Mishra & Naitik Joshi  
**Institution:** The Aditya Birla Public School, Renusagar  
**Platform Version:** Medimate Beta v1.0
