<p align="center">
  <img src="https://komarev.com/ghpvc/?username=ArthOfficial&repo=edunex&label=Repository%20Views&color=0e75b6&style=for-the-badge" alt="Profile Views"/>
</p>

<p align="center">
  <img src="https://img.icons8.com/3d-fluency/94/graduation-cap.png" width="80" alt="Kryin Ephor Logo"/>
</p>

<h1 align="center">Kryin Ephor — The OS for Modern Education</h1>

<p align="center">
  <strong>This is a multi tenant saas school managment website</strong><br/>
  I Built it for large scale schools and scalability
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React 19"/>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 7"/>
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind 4"/>
  <img src="https://img.shields.io/badge/Supabase-Backend-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active%20Development-brightgreen?style=flat-square" alt="Status"/>
  <img src="https://img.shields.io/badge/License-Proprietary-red?style=flat-square" alt="License"/>
  <img src="https://img.shields.io/badge/Multi--Tenant-Yes-blue?style=flat-square" alt="Multi-Tenant"/>
  <img src="https://img.shields.io/badge/Tables-54-orange?style=flat-square" alt="54 Tables"/>
  <img src="https://img.shields.io/badge/RLS%20Policies-211-purple?style=flat-square" alt="RLS Policies"/>
</p>

---
## OpenAI Build Week — Phase 1

**Category: Education** · [OpenAI Build Week](https://openai.com/build-week/)

Kryin Ephor is being built to make a school feel like connected operating system rather than a collection of disconnected portals. 

### What I Built With Codex GPT5.6 Terra for Phase 1

- **Super admin control:** create, manage, and remove school tenants; manage users and school configuration from one platform view.

- **School operations:** class management, teacher assignment, class-wise attendance, users, finance, fee plans, and fee heads.
- **Student and parent experience:** a combined student/parent account model, dashboard switching, school feed, attendance history, academic progress, fees, tests, and performance views.

- **Assessment workflow:** admins and teachers can create a dated test for a class, select one or more subjects, add optional chapter names, then upload marks in a student-by-subject grid. Students see only their own results and class-average comparison.

- **Focus Mode:** a private, browser-local study space with a Pomodoro timer, configurable title, fonts, background, calm music, fullscreen controls, and keyboard/tap shortcuts.

- **Responsive navigation:** mobile users get an accessible sidebar drawer instead of a desktop-only navigation experience.

--- 

### Building with GPT-5.6 and Codex

Kryin Ephor was developed and full reconstructed using gpt5.6 terra under a week with many proper school managment system. I (Arth) just created ui and reformed it a bit other then that whole managment database other ui roles all was created by codex; Codex was used for accelerated implementation, debugging, verification, and documentation inside the live codebase.

| Product and engineering decisions made by the builder | How Codex accelerated the work |
|---|---|
| Keep student and parent access combined under one account, with the student dashboard as the default. | Implemented the role-aware account flow and dashboard switching while preserving tenant boundaries. |
| Make the student dashboard useful and motivating, not an admin dashboard with fewer cards. | Built the school feed, attendance calendar, academic-progress widgets, performance page, and Focus Mode around that direction. |
| Keep teacher work limited to the classes they are assigned. | Applied class-aware filtering to teacher workflows and marks entry. |
| Let school staff create real assessments: choose class, subjects, date, optional chapters, then enter marks. | Shaped the create-test and marks-upload flows, checked actual database constraints, and corrected invalid data handling. |
| Give students a safe way to compare performance. | Added a secure database summary that returns the student's score and aggregate class average without exposing classmates' raw marks. |
| Support future AI use without opening school data to arbitrary clients. | Built the MCP/OAuth foundation with role-aware tools and a restricted-client design for approved AI platforms. |

Codex was used as an engineering collaborator rather than a one-shot generator. It inspected the existing project structure, made targeted edits, validated Supabase constraints and permissions, tested builds, diagnosed CORS and database failures, and committed focused changes. This shortened the feedback loop from “idea → implementation → tested result” while the builder remained responsible for the final product, security, and design choices.

### MCP and AI direction

Phase 1 includes the foundation for a **Kryin MCP server** with OAuth-based account connection. The product direction is deliberately restrictive: only approved AI platforms such as ChatGPT, Claude, and Gemini should be eligible to connect; unknown clients should be blocked. The MCP surface is role-aware:

- **Admins** can access operational information and permitted school-management actions
.
- **Students and combined student/parent accounts** receive read-only access to their own school feed, attendance, timetable, academic progress, tests, and performance.

- **Privacy is enforced at the database layer** through tenant isolation and role-aware access controls, not merely by hiding UI controls.

### Verification mindset

Every feature change was treated as a real product change: the implementation was built, checked against the connected Supabase schema where relevant, and production-built with Vite before completion. Recent examples include validating the exam-type constraint before test scheduling, confirming anonymous users cannot execute the student performance summary, and verifying that responsive routes compile into the production build.

---

## 🎯 What is Kryin Ephor?

Kryin Ephor is a **multi-tenant School Management System** built as a full SaaS platform. 
Its First version is build and released for schools to test also we are currently integrating with a local Indian Rajashtan School.

```
┌──────────────────────────────────────────────────────────────┐
│                  KRYIN EPHOR PLATFORM                        │
│                                                              │
│   🏫 School A    🏫 School B    🏫 School C    🏫 School N │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐                 │
│   │ Students │   │ Students │   │ Students │    ...          │
│   │ Teachers │   │ Teachers │   │ Teachers │                 │
│   │ Finance  │   │ Finance  │   │ Finance  │                 │
│   │ Exams    │   │ Exams    │   │ Exams    │                 │
│   └──────────┘   └──────────┘   └──────────┘                 │
│                                                              │
│              🔐 Tenant Isolation (Row Level Security)        │
│              👤 Role-Based Access Control (7 Roles)          │
│              📊 Unified Super Admin Dashboard                │
└──────────────────────────────────────────────────────────────┘
```
---

## ⚒️ For Judges: 


> ### Test Account Credentials

|Role | Email | Password |
|---|---------|-----|
| **Superadmin** | admin@admin.com | 12341234 |
| **Admin/Principal** | admin@school.com | 12341234 |
| **Teacher** | teacher@school.com | 12341234 |
| **Student** | student@school.com | 12341234 |
| **Receptionist** | receptionist@school.com | 12341234 |
| **Accountant** | accountant@school.com | 12341234 |

---

## ✨ Key Features

<table>
<tr>
<td width="50%">

### 🏢 Multi-Tenant Architecture
- Complete school isolation via `school_id`
- Row Level Security on all 54 tables
- No cross-tenant data leakage
- Per-school feature flags & subscriptions

</td>
<td width="50%">

### 🔐 Enterprise Security
- Supabase Auth with JWT
- 211 RLS policies enforced
- Service Role keys isolated to Edge Functions
- Audit logging & session tracking

</td>
</tr>
<tr>
<td>

### 👥 7-Role RBAC System
- **Super Admin** — Platform-wide control
- **Admin** — School-level management
- **Teacher** — Classes, attendance, grading
- **Student** — Personal dashboard
- **Parent** — Child monitoring
- **Accountant** — Finance & payroll
- **Receptionist** — Visitors & inquiries

</td>
<td>

### 📊 Super Admin Dashboard
- Real-time revenue overview (live from DB)
- Total schools, students, teachers
- Active subscriptions tracking
- System health & alerts monitoring
- School creation & admin management

</td>
</tr>
<tr>
<td>

### 💰 Finance & Billing
- Fee structure management
- Invoice generation & tracking
- Transaction processing
- Salary & payroll system
- SaaS subscription tiers (Starter/Pro/Enterprise)

</td>
<td>

### 📋 Academic Management
- Class & section management
- Subject-teacher mapping
- Timetable scheduling
- Attendance tracking
- Homework & submission system
- Examination & grading

</td>
</tr>
</table>

---

## 🛠 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 19.2 |
| **Language** | TypeScript | 5.9 |
| **Build** | Vite | 7.3 |
| **Styling** | Tailwind CSS | 4.2 |
| **Animations** | Framer Motion | 12.x |
| **Icons** | Lucide React | Latest |
| **Backend** | Supabase (PostgreSQL + Auth) | — |
| **Edge Functions** | Deno (Supabase Functions) | — |
| **Routing** | React Router | 7.x |

---

## 🏗 Architecture

```
EduNex/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── auth/            # Login modals, protected routes
│   │   ├── dashboard/       # Dashboard widgets
│   │   ├── ui/              # Buttons, toasts, transitions
│   │   ├── effects/         # Visual effects
│   │   └── layout/          # App shell, sidebar, navbar
│   │
│   ├── pages/               # Route pages
│   │   ├── LandingPage      # Marketing homepage
│   │   ├── SuperAdminDashboard
│   │   ├── SuperAdminDatabase
│   │   ├── SchoolsManagement
│   │   ├── UserManagement
│   │   ├── FinanceBilling
│   │   ├── AttendancePage
│   │   ├── SystemAlerts
│   │   └── GlobalSetup
│   │
│   ├── config/              # Roles & route configuration
│   ├── context/             # Auth provider (excluded)
│   ├── lib/                 # Supabase client, logger (excluded)
│   └── hooks/               # Custom React hooks
│
├── supabase/
│   ├── functions/           # Edge Functions (server-side)
│   │   ├── create_tenant_admin/
│   │   └── update_admin/
│   ├── schema.sql           # 54-table schema (excluded)
│   └── migrations/          # RLS policies (excluded)
│
├── PRIVATE/                 # 🔒 Excluded — API keys & secrets
├── .MD/                     # 🔒 Excluded — Internal docs
└── ExWeb/                   # Design reference files
```

---

## 📦 Database Schema — 54 Tables

The database is organized into **8 logical layers**:

| # | Layer | Tables | Purpose |
|---|-------|--------|---------|
| 1 | **Core** | `schools`, `profiles`, `academic_years` | Foundation entities |
| 2 | **Identity** | `roles`, `permissions`, `role_permissions`, `memberships` | RBAC system |
| 3 | **Academic** | `classes`, `subjects`, `enrollments`, `timetable`, `attendance`, `homework` | Teaching & learning |
| 4 | **Exams** | `exams`, `exam_subjects`, `exam_results`, `grading_scales` | Assessment |
| 5 | **Finance** | `fee_structures`, `invoices`, `transactions`, `salary` | Money management |
| 6 | **Billing** | `subscription_plans`, `school_subscriptions`, `payment_methods` | SaaS billing |
| 7 | **Communication** | `notifications`, `events`, `messages`, `threads` | Messaging |
| 8 | **Security** | `system_logs`, `audit_logs`, `login_attempts`, `user_sessions` | Monitoring |

> All tables enforce tenant isolation via `school_id` + Row Level Security.

---

## 🔑 Subscription Tiers

| | Starter | Pro | Enterprise |
|---|---------|-----|-----------|
| **Price** | ₹999/mo | ₹2,999/mo | ₹7,999/mo |
| **Students** | 100 | 500 | 5,000 |
| **Admins** | 2 | 5 | 20 |
| **Teachers** | 10 | 50 | 500 |
| **Storage** | 1 GB | 5 GB | 50 GB |
| **Messaging** | ❌ | ✅ | ✅ |
| **Online Classes** | ❌ | ✅ | ✅ |
| **API Access** | ❌ | ❌ | ✅ |
| **White Labeling** | ❌ | ❌ | ✅ |
| **SMS Notifications** | ❌ | ✅ | ✅ |
| **Advanced Reports** | ❌ | ✅ | ✅ |
| **Custom Roles** | ❌ | ✅ | ✅ |

---

## 🎨 Design Philosophy

Kryin Ephor follows a **premium, soft-layered design system**:

- 🎯 **Clay-morphism** — Soft shadows with depth
- 🟢 **Emerald + Lime accent palette** — Professional education aesthetic
- ✍️ **Plus Jakarta Sans** — Modern, bold typography
- 🌊 **Framer Motion** — Smooth page transitions & micro-interactions
- 📱 **Responsive** — Desktop-first, mobile-ready

---

## 🚀 Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/your-username/SaaSSchool.git
cd SaaSSchool

# 2. Install dependencies
npm install

# 3. Add your PRIVATE/ folder with .env file
# (Contains Supabase URL, API keys, security config)

# 4. Start development server
npm run dev
```

---

## 📄 Environment Variables Required

Create a `PRIVATE/.env` file with:

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

---

## 🗺 Roadmap

- [x] Multi-tenant database schema (54 tables)
- [x] Super Admin dashboard with live data
- [x] School CRUD with admin creation
- [x] Edge Functions for secure user management
- [x] 7-role RBAC system
- [x] Finance & billing module
- [x] Attendance tracking
- [x] System alerts & monitoring
- [x] Parent portal
- [x] Student AI portal
- [x] Teacher class management
- [ ] Online class integration (Zoom/Meet)
- [ ] SMS/Push notification gateway
- [ ] Mobile-responsive redesign
- [x] Advanced analytics & reporting
- [x] Data export (CSV/PDF)

---

## 🤝 Contributing

This is a **proprietary project**. Contributions are not accepted at this time.

If you have questions or want to discuss the architecture, open an issue.

## 🚀 Vercel Deployment & GitHub Sync Workflow

This project is deployed on **Vercel** via the [`Kryin-Labs/KryinEphor`](https://github.com/Kryin-Labs/KryinEphor) repository.

### Remotes Setup
- **`kryin`** → `https://github.com/Kryin-Labs/KryinEphor.git` *(Production Vercel deployment target)*
- **`origin`** → `https://github.com/ArthOfficial/KryinEphor.git` *(Personal backup repository)*

### How to Push & Trigger a Vercel Update
To push new changes and immediately trigger a fresh Vercel deployment:

```bash
# 1. Stage and commit your changes
git add .
git commit -m "feat: your feature description"

# 2. Push to Kryin-Labs to trigger Vercel deployment
git push kryin main

# 3. (Optional) Sync backup repository
git push origin main
```

Or run via npm:
```bash
npm run push:deploy   # pushes to kryin main
npm run push:sync     # pushes to both kryin and origin
```

### Git Identity & Author Emails (Vercel Verification)
If you ever need to set or switch the commit author identity for Vercel Hobby verification:

```bash
# Option A: Arth Official (Primary Personal)
git config user.name "Arth Official"
git config user.email "purohitarthbkn@gmail.com"

# Option B: Kryin Labs (Organization)
git config user.name "Kryin Labs"
git config user.email "official.kryin@gmail.com"
```

> **Note on `vercel.json`:** Vercel strictly enforces standard JSON formatting. Do not add comments (`//` or `/* */`) or `$comment` keys directly into `vercel.json` as it causes Vercel builds to fail.

---

## 📜 License

**Proprietary** — All rights reserved.

This software is the intellectual property of the project owner. Unauthorized copying, distribution, modification, or deployment is strictly prohibited.

---

<p align="center">
  <img src="https://img.icons8.com/3d-fluency/48/graduation-cap.png" width="24" alt="Kryin Ephor"/>
  <br/>
  <strong>Kryin Ephor</strong> — Empowering Education, Simplifying Management
  <br/>
  <sub>Built with ❤️ using React, TypeScript, Supabase & Tailwind</sub>
</p>

---

```
Copyright (c) 2026 Arth
All rights reserved.

This source code is proprietary and confidential.
Unauthorized copying, modification, distribution, public display,
or commercial use of this software is strictly prohibited.

This repository is provided for review purposes only.
No license is granted to use, reproduce, or distribute this code.
```
"# Kryin Ephor" 
