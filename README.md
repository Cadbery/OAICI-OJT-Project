# Walter AI Tutor Enhancement

Walter AI Tutor Enhancement is a web-based learning workspace designed to improve the student experience when using Walter AI and Noodle Factory. The project centralizes course interaction, AI chat sessions, saved learning content, grades, feedback, and personal notes into one protected interface.

## Overview

The system provides a student-focused interface that connects with Noodle Factory through browser automation. It allows learners to continue module-based AI conversations, manage chat sessions, save important tutor responses, review activity grades, view AI feedback, and maintain personal study notes.

This project was developed as an OJT project to enhance the usability and accessibility of the existing Walter AI learning experience.

## Features

- Protected login page for controlled access
- Course home interface with module navigation
- Contextual AI chat sessions per course module
- Multiple chat session support with recent chat history
- Bookmarking of AI tutor responses
- Quiz and role-play grade viewing
- Activity attempt review for quiz and role-play results
- AI feedback page with summarized strengths and weaknesses
- User notes page for personal study notes
- Puppeteer-based integration with Noodle Factory

## Tech Stack

- **Next.js**
- **React**
- **TypeScript**
- **Tailwind CSS**
- **Node.js**
- **Puppeteer**
- **Microsoft Edge**
- **Browser Storage**
- **Noodle Factory Platform**

## System Architecture

The frontend is built using the Next.js App Router and React components. The App Router manages protected navigation and page routing, while React components display the main learning workspace.

The frontend communicates with protected Next.js API routes through Fetch/JSON requests. These API routes coordinate Puppeteer browser automation, which interacts with the Noodle Factory platform to retrieve course data, chat sessions, grades, activity attempts, and learner feedback.

## Prerequisites

Before running the project, make sure the following are installed:

- Node.js
- npm
- Microsoft Edge
- Git
- Visual Studio Code or any code editor

## Installation

Clone the repository:

```bash
git clone <repository-url>
cd agentic-tutor-ui

Install dependencies:
npm install

## Environment Setup

Create a .env.local file in the project root and configure the required environment variables.
Example:
AUTH_SECRET=your_auth_secret
AUTH_EMAIL=your_email
AUTH_PASSWORD=your_password
If the project uses a local account creation script, create a user account with:
npm run auth:create-user -- "email@example.com" "password"

## Running the Project

Start the development server:
npm run dev

Open the application in the browser:
http://localhost:3000

## Important Notes

This project relies on Puppeteer browser automation to interact with Noodle Factory. For best results, run the system locally and make sure the Puppeteer-controlled browser profile is already logged in to Noodle Factory.
Because Noodle Factory uses Microsoft login, deploying the full automation workflow to a cloud hosting service may be difficult unless browser authentication is handled separately.

## Build

To create a production build:
npm run build

To start the production server:
npm run start

## Project Purpose

The purpose of this project is to improve the learning workflow of students by providing a more organized and user-friendly interface for interacting with Walter AI and Noodle Factory learning data.

## Developer

Developed as part of an OJT project focused on enhancing the Walter AI Tutor user experience.
