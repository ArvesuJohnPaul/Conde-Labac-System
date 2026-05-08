---
name: conde-labak-techstack
description: >
  Complete technology stack and production requirements reference for the GIS-Enabled Integrated
  Barangay Management and Decision Support System for Barangay Conde Labak, Batangas City.
  Use this skill whenever the team needs to identify what language, framework, library, database,
  cloud tool, security measure, or AI/ML component is required for any part of the system — including
  frontend, backend, GIS mapping, AI integration, deployment, and cybersecurity compliance.
---

# Conde Labak GIS Barangay System — Full Tech Stack & Production Requirements

## 1. Programming Languages

| Language       | Role in the System                                                                   |
| -------------- | ------------------------------------------------------------------------------------ |
| **HTML & CSS** | Frontend structure and styling; ensures a clean and accessible UI across all modules |
| **JavaScript** | Frontend interactivity, dynamic dashboard components, and map rendering              |
| **PHP**        | Server-side backend development; handles routing, business logic, and API endpoints  |
| **Python**     | AI/ML components — predictive analytics and sentiment analysis                       |
| **SQL**        | Database queries and data management across PostgreSQL                               |

---

## 2. Frameworks & Libraries

### Frontend

| Tool              | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| **Bootstrap**     | Responsive and consistent UI styling across all system pages      |
| **Leaflet.js**    | Lightweight JavaScript library for rendering interactive GIS maps |
| **OpenStreetMap** | Free, open-source base map tiles used with Leaflet.js             |

### Backend

| Tool                          | Purpose                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Laravel (PHP)**             | Primary backend framework; handles REST API, authentication, routing, and business logic             |
| **Flask or FastAPI (Python)** | Lightweight Python microservice framework; exposes AI/ML models as callable API endpoints to Laravel |

### AI / Machine Learning

| Tool                | Purpose                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **scikit-learn**    | Builds and trains the predictive analytics model for forecasting incident trends and high-risk zones |
| **spaCy**           | Natural language processing (NLP) for tokenization and sentiment classification of resident feedback |
| **NLTK**            | Alternative/supplementary NLP library for sentiment analysis                                         |
| **joblib / pickle** | Saves and loads trained ML models into the Flask/FastAPI microservice                                |

---

## 3. Databases

| Database       | Purpose                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL** | Primary relational database; stores all structured data — residents, certificates, incidents, feedback, and user accounts    |
| **PostGIS**    | PostgreSQL extension; adds spatial and geographic data support for storing household coordinates, hazard zones, and GIS data |

---

## 4. Cloud & Deployment Infrastructure

| Tool                               | Purpose                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Apache Web Server**              | Primary local server hosted on-premise at the barangay hall; allows system to run without internet dependency |
| **Google Cloud Storage or AWS S3** | Offsite cloud backup for database snapshots and exported files                                                |
| **Cloudflare**                     | DNS management and basic DDoS protection if the system is accessible over the internet                        |

---

## 5. Cybersecurity & Compliance

| Measure                                           | Purpose                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **HTTPS / SSL Certificate**                       | Encrypts all data transmitted between the client browser and the server                                                   |
| **Laravel Sanctum or JWT (JSON Web Tokens)**      | Secure API authentication and session token management                                                                    |
| **Role-Based Access Control (RBAC)**              | Enforced at both application and database level; restricts module access by user role (Resident, Official, Administrator) |
| **Bcrypt Password Hashing**                       | Securely stores user passwords in the database                                                                            |
| **Audit Trail Logging**                           | All user actions are recorded with timestamps and user identifiers for accountability                                     |
| **Input Validation & Sanitization**               | Prevents SQL injection and cross-site scripting (XSS) attacks                                                             |
| **Republic Act 10173 (Data Privacy Act of 2012)** | Legal compliance framework governing how resident data is handled and stored                                              |

---

## 6. System Diagrams Required for Production

The following diagrams must be produced and maintained as part of the system documentation:

- **System Architecture Diagram** — overall structure of all components
- **Context Diagram (DFD Level 0)** — shows Residents, Barangay Officials, and Administrator interactions with the system boundary
- **Level 1 DFD** — decomposes the system into 8 core processes: Account Claiming, Certificate Processing, Incident Reporting, Feedback Management, GIS Mapping, Analytics/Decision Support, User/Access Management, and Archive Process
- **Flowchart** — step-by-step user flow for all three roles (Resident, Official, Admin)
- **Entity-Relationship Diagram (ERD)** — full database schema including USER, ROLE, PERMISSION, ROLE_PERMISSION, HOUSEHOLD, INCIDENT ZONE, INCIDENT, CERTIFICATE, FEEDBACK, AUDIT_LOG, and ARCHIVE tables

---

## 7. Testing Requirements for Production Readiness

| Test Type                             | Scope                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Unit Testing**                      | Each module tested in isolation: resident registration, certificate generation, blotter management, predictive analytics |
| **Integration Testing**               | Data flow between resident management ↔ PostGIS, blotter module ↔ GIS heatmap, Laravel backend ↔ Python AI microservice  |
| **User Acceptance Testing (UAT)**     | Barangay officials and staff validate usability, effectiveness, and accuracy before full deployment                      |
| **Security & Performance Benchmarks** | HTTPS, JWT, RBAC tested for RA 10173 compliance; speed and failure testing via surveys                                   |

---

## 8. Development Methodology

- **Framework:** Agile Scrum
- **Approach:** Iterative Sprints with stakeholder review and Sprint Retrospectives at each cycle end
- **Deployment:** Piloted within Barangay Conde Labak before full rollout
- **Data Migration:** Existing resident and incident records migrated into PostgreSQL + PostGIS with validation to remove inconsistencies

---

## 9. AI Integration Architecture (Quick Reference)

```
[User submits feedback / incident data]
            ↓
[Laravel Backend (PHP)]
            ↓ HTTP POST (JSON payload)
[Flask / FastAPI Microservice (Python)]
            ↓
[scikit-learn (predictive) / spaCy (sentiment)]
            ↓ JSON response
[Laravel Backend]
            ↓
[Analytics Dashboard (Leaflet.js + JavaScript)]
```

- Models are trained offline on PostgreSQL historical data
- Trained models are saved with `joblib` and loaded into the microservice
- Laravel calls the microservice via REST API; results are displayed on the analytics dashboard

---

## 10. External Entities & Their System Interactions

| Entity                 | Inputs to System                                                    | Outputs from System                                            |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Residents**          | Feedback, blotter report, resident information, certificate request | Issued certificates, request status, account granted, GIS maps |
| **Barangay Officials** | Approval requests, incident updates, GIS/hazard data access         | Predictive insights, incident reports, hazard maps             |
| **Administrator**      | User role access, archive changes, account details                  | Audit trail logs, analytics dashboard, archive confirmations   |
