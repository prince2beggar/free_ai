// Production templates for Group 1 Productivity Studio tools

const templates = {
  email: {
    id: 'email',
    name: 'Email Generator',
    nameBn: 'ইমেইল জেনারেটর',
    category: 'writing',
    preset: 'writing',
    task: 'draft',
    description:
      'Draft professional, formal, persuasive, or casual emails with clear subject lines and call-to-actions.',
    descriptionBn: 'স্পষ্ট বিষয় এবং কার্যকর ভাষা সহ পেশাদার ও আকর্ষণীয় ইমেইল প্রস্তুত করুন।',
    fields: [
      {
        key: 'recipient',
        label: 'Recipient Name / Role',
        labelBn: 'প্রাপকের নাম বা পদবী',
        type: 'text',
        placeholder: 'e.g. Hiring Manager, Client, Project Lead',
      },
      {
        key: 'purpose',
        label: 'Email Purpose / Goal',
        labelBn: 'ইমেইলের মূল উদ্দেশ্য',
        type: 'text',
        placeholder: 'e.g. Follow-up after interview, Project status update, Partnership proposal',
        required: true,
      },
      {
        key: 'tone',
        label: 'Tone',
        labelBn: 'ভাষার ভঙ্গি',
        type: 'select',
        options: ['professional', 'formal', 'casual', 'persuasive', 'empathetic', 'concise'],
        default: 'professional',
      },
      {
        key: 'keyPoints',
        label: 'Key Points to Include',
        labelBn: 'গুরুত্বপূর্ণ তথ্যাবলী',
        type: 'textarea',
        placeholder: 'List main topics, dates, deliverables, or questions to include...',
        required: true,
      },
      {
        key: 'callToAction',
        label: 'Call to Action (Optional)',
        labelBn: 'পরবর্তী পদক্ষেপ (ঐচ্ছিক)',
        type: 'text',
        placeholder: 'e.g. Schedule a call by Tuesday, Reply with feedback',
      },
      {
        key: 'senderName',
        label: 'Your Name / Signature',
        labelBn: 'আপনার নাম বা স্বাক্ষর',
        type: 'text',
        placeholder: 'e.g. Rahim Ahmed',
      },
    ],
    buildPrompt(data, lang = 'en') {
      const isBn = lang === 'bn';
      if (isBn) {
        return `অনুগ্রহ করে নিচের তথ্যের ভিত্তিতে একটি পূর্ণাঙ্গ, পেশাদার ইমেইল প্রস্তুত করুন:
- প্রাপক: ${data.recipient || 'সংশ্লিষ্ট কর্মকর্তা'}
- উদ্দেশ্য: ${data.purpose}
- ভাষার ভঙ্গি: ${data.tone || 'professional'}
- মূল বিষয়বস্তু:
${data.keyPoints}
${data.callToAction ? `- পরবর্তী পদক্ষেপ (Call to Action): ${data.callToAction}` : ''}
${data.senderName ? `- প্রেরক: ${data.senderName}` : ''}

আউটপুট ফরম্যাট:
1. বিষয় (Subject Line):
2. সম্বোধন (Salutation):
3. ইমেইলের মূল বক্তব্য (Body Paragraphs):
4. পরবর্তী পদক্ষেপ (Call to Action):
5. বিদায় সম্ভাষণ ও স্বাক্ষর (Sign-off & Signature):`;
      }
      return `Please draft a complete, high-impact email based on the following details:
- Recipient: ${data.recipient || 'Recipient'}
- Purpose: ${data.purpose}
- Tone: ${data.tone || 'professional'}
- Key Points:
${data.keyPoints}
${data.callToAction ? `- Call to Action: ${data.callToAction}` : ''}
${data.senderName ? `- Sender: ${data.senderName}` : ''}

Structure the output with:
1. Subject Line: (Engaging and clear)
2. Salutation:
3. Body: (Well-structured, concise, and polite)
4. Call to Action:
5. Professional Sign-off & Signature:`;
    },
  },

  resume: {
    id: 'resume',
    name: 'CV & Resume Builder',
    nameBn: 'সিভি ও রেজুমে বিল্ডার',
    category: 'writing',
    preset: 'writing',
    task: 'draft',
    description:
      'Generate high-impact, ATS-friendly resumes tailored for tech, business, and creative roles.',
    descriptionBn: 'চাকরির আবেদনের জন্য প্রফেশনাল, গোছানো এবং আধুনিক সিভি বা রেজুমে তৈরি করুন।',
    fields: [
      {
        key: 'fullName',
        label: 'Full Name',
        labelBn: 'পূর্ণ নাম',
        type: 'text',
        placeholder: 'e.g. Tanvir Hasan',
        required: true,
      },
      {
        key: 'targetRole',
        label: 'Target Job Title',
        labelBn: 'উদ্দিষ্ট পদবী',
        type: 'text',
        placeholder: 'e.g. Senior Full-Stack Engineer, Product Manager',
        required: true,
      },
      {
        key: 'contactInfo',
        label: 'Contact Details',
        labelBn: 'যোগাযোগের তথ্য',
        type: 'text',
        placeholder: 'e.g. email@example.com | +8801700000000 | Dhaka, Bangladesh | LinkedIn',
      },
      {
        key: 'summary',
        label: 'Professional Summary / Bio',
        labelBn: 'পেশাদার সারসংক্ষেপ',
        type: 'textarea',
        placeholder: 'Summary of your experience, passion, and core strengths...',
      },
      {
        key: 'skills',
        label: 'Key Skills & Tools',
        labelBn: 'দক্ষতা ও প্রযুক্তি',
        type: 'textarea',
        placeholder:
          'e.g. JavaScript, TypeScript, Node.js, PostgreSQL, Docker, Agile, Team Leadership',
        required: true,
      },
      {
        key: 'experience',
        label: 'Work Experience / Key Projects',
        labelBn: 'কাজের অভিজ্ঞতা ও প্রজেক্ট',
        type: 'textarea',
        placeholder: 'Company names, roles, dates, and major accomplishments with metrics...',
        required: true,
      },
      {
        key: 'education',
        label: 'Education & Certifications',
        labelBn: 'শিক্ষাগত যোগ্যতা ও সনদ',
        type: 'text',
        placeholder: 'e.g. B.Sc. in Computer Science, University of Dhaka',
      },
    ],
    buildPrompt(data, lang = 'en') {
      const isBn = lang === 'bn';
      if (isBn) {
        return `নিচের তথ্যের ভিত্তিতে একটি আধুনিক, প্রফেশনাল এবং ATS-বান্ধব রেজুমে (CV) প্রস্তুত করুন:
- প্রার্থীর নাম: ${data.fullName}
- উদ্দিষ্ট পদবী: ${data.targetRole}
- যোগাযোগ: ${data.contactInfo || 'প্রযোজ্য নয়'}
- পেশাদার পরিচিতি: ${data.summary || 'প্রযোজ্য নয়'}
- প্রধান দক্ষতা ও টুলস: ${data.skills}
- কাজের অভিজ্ঞতা ও প্রজেক্ট:
${data.experience}
- শিক্ষাগত যোগ্যতা: ${data.education || 'প্রযোজ্য নয়'}

আউটপুট ফরম্যাট:
একটি পরিষ্কার মার্কডাউন রেজুমে তৈরি করুন যাতে নিচের সেকশনগুলো সুনির্দিষ্টভাবে থাকে:
# [নাম]
### [পদবী] | [যোগাযোগ]
## পেশাদার সারসংক্ষেপ (Professional Summary)
## প্রধান দক্ষতা (Core Competencies & Technical Skills)
## কর্মঅভিজ্ঞতা (Work Experience) - বুলেট পয়েন্টে প্রভাব ও ফলাফল সহ
## শিক্ষাগত যোগ্যতা (Education & Credentials)`;
      }
      return `Generate a clean, high-impact, ATS-optimized professional Resume / CV for:
- Candidate Name: ${data.fullName}
- Target Role: ${data.targetRole}
- Contact Details: ${data.contactInfo || 'email@example.com | Phone | Location'}
- Professional Summary: ${data.summary || 'Experienced professional with proven track record.'}
- Core Skills: ${data.skills}
- Experience & Projects:
${data.experience}
- Education: ${data.education || 'Degree, University'}

Output Format:
Format as a complete Markdown Resume with structured headers:
# ${data.fullName}
### ${data.targetRole} · ${data.contactInfo || 'Contact'}
## Professional Summary
## Core Competencies & Technical Skills
## Professional Experience (Quantified achievements with bullet points)
## Education & Certifications`;
    },
  },

  proposal: {
    id: 'proposal',
    name: 'Business Proposal Generator',
    nameBn: 'বিজনেস প্রপোজাল জেনারেটর',
    category: 'writing',
    preset: 'writing',
    task: 'draft',
    description:
      'Craft comprehensive commercial proposals with problem definition, solution, deliverables, timeline, and budget.',
    descriptionBn:
      'ক্লায়েন্ট বা অংশীদারদের জন্য পূর্ণাঙ্গ বাণিজ্যিক প্রস্তাবনা (প্রপোজাল) তৈরি করুন।',
    fields: [
      {
        key: 'proposalTitle',
        label: 'Proposal Title / Project Name',
        labelBn: 'প্রকল্প বা প্রস্তাবনার শিরোনাম',
        type: 'text',
        placeholder: 'e.g. Next-Generation Cloud AI Workspace Integration',
        required: true,
      },
      {
        key: 'clientName',
        label: 'Client / Target Organization',
        labelBn: 'ক্লায়েন্ট বা প্রতিষ্ঠানের নাম',
        type: 'text',
        placeholder: 'e.g. Apex Enterprises',
        required: true,
      },
      {
        key: 'problem',
        label: 'Client Problem / Opportunity',
        labelBn: 'ক্লায়েন্টের মূল সমস্যা বা প্রয়োজন',
        type: 'textarea',
        placeholder: 'Describe the challenge the client is facing and why they need this...',
        required: true,
      },
      {
        key: 'solution',
        label: 'Proposed Solution & Approach',
        labelBn: 'প্রস্তাবিত সমাধান ও কৌশল',
        type: 'textarea',
        placeholder: 'Outline your methodology, architecture, or services offered...',
        required: true,
      },
      {
        key: 'deliverables',
        label: 'Deliverables & Scope',
        labelBn: 'নির্দিষ্ট ডেলিভারেবলস ও কাজের পরিধি',
        type: 'textarea',
        placeholder: 'List tangible milestones, software modules, or reports...',
        required: true,
      },
      {
        key: 'timelineBudget',
        label: 'Timeline & Budget Estimates',
        labelBn: 'সময়সীমা ও বাজেট প্রাক্কলন',
        type: 'text',
        placeholder: 'e.g. 8 Weeks | Phase 1: 50,000 BDT, Phase 2: 75,000 BDT',
      },
    ],
    buildPrompt(data, lang = 'en') {
      const isBn = lang === 'bn';
      if (isBn) {
        return `অনুগ্রহ করে নিচের তথ্যের ভিত্তিতে একটি আনুষ্ঠানিক ও আকর্ষণীয় বাণিজ্যিক প্রপোজাল (Business Proposal) প্রস্তুত করুন:
- প্রকল্পের নাম: ${data.proposalTitle}
- ক্লায়েন্ট: ${data.clientName}
- ক্লায়েন্টের চ্যালেঞ্জ: ${data.problem}
- প্রস্তাবিত সমাধান: ${data.solution}
- প্রধান ডেলিভারেবলস: ${data.deliverables}
- সময়সীমা ও বাজেট: ${data.timelineBudget || 'আলোচনা সাপেক্ষে'}

আউটপুট কাঠামো:
1. নির্বাহী সারসংক্ষেপ (Executive Summary)
2. সমস্যার প্রেক্ষাপট ও প্রয়োজনীয়তা (Problem Statement & Needs)
3. প্রস্তাবিত সমাধান ও কর্মপরিকল্পনা (Proposed Solution & Methodology)
4. মূল ডেলিভারেবলস (Deliverables & Scope of Work)
5. সময়সূচী ও বাস্তবায়ন ধাপ (Timeline & Milestones)
6. আর্থিক প্রস্তাবনা ও বাজেট টেবিল (Financial Proposal / Budget Table)
7. কেন আমাদের বেছে নেবেন (Why Choose Us & Next Steps)`;
      }
      return `Draft an authoritative, highly persuasive Business Proposal based on the following details:
- Project Title: ${data.proposalTitle}
- Prepared for Client: ${data.clientName}
- Problem Statement / Need: ${data.problem}
- Proposed Solution & Value Proposition: ${data.solution}
- Deliverables & Scope: ${data.deliverables}
- Timeline & Budget: ${data.timelineBudget || 'To be finalized'}

Format with structured markdown sections:
1. Executive Summary
2. Problem Statement & Objectives
3. Proposed Technical / Service Solution
4. Scope of Work & Deliverables (Markdown Table)
5. Project Timeline & Milestones
6. Commercial Terms & Investment Budget (Markdown Table)
7. Value Proposition & Next Steps for Approval`;
    },
  },

  meetingNotes: {
    id: 'meetingNotes',
    name: 'Meeting Notes & Summaries',
    nameBn: 'মিটিং নোট ও সারসংক্ষেপ',
    category: 'summary',
    preset: 'summary',
    task: 'summarize',
    description:
      'Transform raw meeting transcripts and discussion points into structured summaries, key decisions, and action items.',
    descriptionBn: 'মিটিংয়ের আলোচনা থেকে মূল সিদ্ধান্ত, কার্যতালিকা ও সংক্ষেপ প্রস্তুত করুন।',
    fields: [
      {
        key: 'meetingTitle',
        label: 'Meeting Title / Topic',
        labelBn: 'মিটিংয়ের বিষয়',
        type: 'text',
        placeholder: 'e.g. Q4 Product Roadmap & Sprint Planning',
        required: true,
      },
      {
        key: 'attendees',
        label: 'Attendees / Participants (Optional)',
        labelBn: 'অংশগ্রহণকারী (ঐচ্ছিক)',
        type: 'text',
        placeholder: 'e.g. Product Lead, Tech Lead, Design Team',
      },
      {
        key: 'summaryStyle',
        label: 'Summary Format',
        labelBn: 'সারসংক্ষেপের ধরন',
        type: 'select',
        options: ['bullets', 'executive', 'tldr', 'simplified'],
        default: 'bullets',
      },
      {
        key: 'rawNotes',
        label: 'Meeting Transcript or Rough Notes',
        labelBn: 'মিটিংয়ের খসড়া নোট বা ট্রান্সক্রিপ্ট',
        type: 'textarea',
        placeholder: 'Paste raw bullet points, transcript, or conversation notes here...',
        required: true,
      },
    ],
    buildPrompt(data, lang = 'en') {
      const isBn = lang === 'bn';
      if (isBn) {
        return `নিচের মিটিং নোটস থেকে একটি অত্যন্ত গোছানো এবং কার্যোপযোগী মিটিং সারসংক্ষেপ তৈরি করুন:
- মিটিংয়ের বিষয়: ${data.meetingTitle}
- অংশগ্রহণকারী: ${data.attendees || 'সংশ্লিষ্ট দল'}
- ফরম্যাট: ${data.summaryStyle || 'bullets'}
- মিটিংয়ের খসড়া আলোচনা:
${data.rawNotes}

আউটপুট কাঠামো:
1. মিটিং সারসংক্ষেপ (Executive Overview)
2. প্রধান আলোচিত বিষয়সমূহ (Key Discussion Points)
3. গৃহীত সিদ্ধান্তসমূহ (Decisions Made)
4. পরবর্তী কার্যতালিকা (Action Items & Next Steps - কে কোন দায়িত্ব পালন করবেন)`;
      }
      return `Distill the following raw meeting notes into a crisp, actionable Meeting Minutes & Summary document:
- Topic: ${data.meetingTitle}
- Participants: ${data.attendees || 'Team members'}
- Style: ${data.summaryStyle || 'bullets'}
- Raw Discussion Notes:
${data.rawNotes}

Structure the response with:
1. Executive Summary (Concise overview of the meeting purpose and outcome)
2. Core Topics Discussed (Grouped logically)
3. Key Decisions Reached (Bullet points)
4. Action Items Table (Task, Assignee/Owner, Deadline/Priority)`;
    },
  },

  contentCreation: {
    id: 'contentCreation',
    name: 'Content & Creative Idea Generator',
    nameBn: 'কনটেন্ট ও ক্রিয়েটিভ আইডিয়া জেনারেটর',
    category: 'writing',
    preset: 'writing',
    task: 'draft',
    description:
      'Brainstorm creative angles, viral hooks, blog articles, social media campaigns, and marketing copy.',
    descriptionBn:
      'সোশ্যাল মিডিয়া, ব্লগ, ভিডিও স্ক্রিপ্ট বা বিজ্ঞাপনের জন্য ক্রিয়েটিভ আইডিয়া ও কনটেন্ট তৈরি করুন।',
    fields: [
      {
        key: 'topic',
        label: 'Topic or Product',
        labelBn: 'মূল বিষয় বা পণ্যের নাম',
        type: 'text',
        placeholder: 'e.g. AI-driven productivity tools for students and freelancers',
        required: true,
      },
      {
        key: 'format',
        label: 'Content Format',
        labelBn: 'কনটেন্টের মাধ্যম',
        type: 'select',
        options: [
          'Blog Post',
          'LinkedIn Post',
          'Twitter/X Thread',
          'YouTube/Reels Script',
          'Marketing Ad Copy',
          'Creative Brainstorming Ideas',
        ],
        default: 'Blog Post',
      },
      {
        key: 'targetAudience',
        label: 'Target Audience',
        labelBn: 'উদ্দিষ্ট পাঠক/দর্শক',
        type: 'text',
        placeholder: 'e.g. Freelancers, Small Business Owners, Students',
      },
      {
        key: 'tone',
        label: 'Tone of Voice',
        labelBn: 'ভাষার ভঙ্গি',
        type: 'select',
        options: ['persuasive', 'casual', 'professional', 'empathetic', 'formal'],
        default: 'persuasive',
      },
      {
        key: 'instructions',
        label: 'Specific Angles or Keywords (Optional)',
        labelBn: 'বিশেষ দিক বা কি-ওয়ার্ড (ঐচ্ছিক)',
        type: 'textarea',
        placeholder: 'e.g. Emphasize saving 10 hours a week, include strong call to action',
      },
    ],
    buildPrompt(data, lang = 'en') {
      const isBn = lang === 'bn';
      if (isBn) {
        return `নিচের তথ্যের ভিত্তিতে একটি আকর্ষণীয় এবং উচ্চমানের কনটেন্ট তৈরি করুন:
- বিষয়: ${data.topic}
- মাধ্যম: ${data.format}
- উদ্দিষ্ট দর্শক: ${data.targetAudience || 'সাধারণ পাঠক'}
- ভাষার ভঙ্গি: ${data.tone || 'persuasive'}
${data.instructions ? `- বিশেষ নির্দেশনা: ${data.instructions}` : ''}

আউটপুট কাঠামো:
1. আকর্ষণীয় শিরোনাম ও হুক (Catchy Title & Hook)
2. কনটেন্টের মূল অংশ (Complete Content Body - প্যারাগ্রাফ বা পয়েন্ট আকারে)
3. কল-টু-অ্যাকশন (Call to Action)
4. প্রাসঙ্গিক হ্যাশট্যাগ ও কি-ওয়ার্ড (Relevant Hashtags & Keywords)`;
      }
      return `Create engaging, high-converting content for:
- Topic / Product: ${data.topic}
- Content Format: ${data.format}
- Target Audience: ${data.targetAudience || 'General audience'}
- Tone: ${data.tone || 'persuasive'}
${data.instructions ? `- Extra Guidelines: ${data.instructions}` : ''}

Format the response with:
1. Attention-Grabbing Headlines (Provide 3 strong hook variations)
2. Main Content Body (Engaging storytelling, value-driven takeaways)
3. Call to Action (Compelling closing prompt)
4. Suggested Hashtags & Engagement Questions`;
    },
  },

  presentation: {
    id: 'presentation',
    name: 'AI Presentation Builder',
    nameBn: 'এআই প্রেজেন্টেশন বিল্ডার',
    category: 'writing',
    preset: 'writing',
    task: 'draft',
    description:
      'Build complete slide decks with slide titles, structured bullet points, and speaker notes.',
    descriptionBn:
      'স্লাইড শিরোনাম, মূল বুলেট পয়েন্ট এবং স্পিকার নোট সহ পূর্ণাঙ্গ প্রেজেন্টেশন স্লাইড তৈরি করুন।',
    fields: [
      {
        key: 'presentationTitle',
        label: 'Presentation Topic / Title',
        labelBn: 'প্রেজেন্টেশনের বিষয় বা শিরোনাম',
        type: 'text',
        placeholder: 'e.g. Introduction to Autonomous AI Agents in Enterprise',
        required: true,
      },
      {
        key: 'numSlides',
        label: 'Number of Slides',
        labelBn: 'স্লাইড সংখ্যা',
        type: 'select',
        options: [
          '5 Slides (Pitch)',
          '8 Slides (Overview)',
          '10 Slides (Standard)',
          '15 Slides (Comprehensive)',
        ],
        default: '8 Slides (Overview)',
      },
      {
        key: 'targetAudience',
        label: 'Target Audience',
        labelBn: 'শ্রোতা / অডিয়েন্স',
        type: 'text',
        placeholder: 'e.g. Investors, University Students, Corporate Executives',
      },
      {
        key: 'keyPoints',
        label: 'Key Points to Cover',
        labelBn: 'আলোচ্য মূল বিষয়সমূহ',
        type: 'textarea',
        placeholder: 'List main topics, data points, challenges, and proposed conclusions...',
        required: true,
      },
    ],
    buildPrompt(data, lang = 'en') {
      const isBn = lang === 'bn';
      if (isBn) {
        return `নিচের তথ্যের ভিত্তিতে একটি পূর্ণাঙ্গ এবং আকর্ষণীয় স্লাইড ডেক (Presentation Slide Deck) প্রস্তুত করুন:
- প্রেজেন্টেশনের শিরোনাম: ${data.presentationTitle}
- স্লাইড সংখ্যা: ${data.numSlides}
- অডিয়েন্স: ${data.targetAudience || 'সাধারণ শ্রোতা'}
- মূল আলোচ্য বিষয়:
${data.keyPoints}

আউটপুট কাঠামো:
প্রতিটি স্লাইড স্পষ্টভাবে '---' দিয়ে আলাদা করুন এবং নিচের ফরম্যাটে সাজান:
---
### স্লাইড [নম্বর]: [স্লাইডের শিরোনাম]
**মূল বক্তব্য:**
- [বুলেট পয়েন্ট ১]
- [বুলেট পয়েন্ট ২]
- [বুলেট পয়েন্ট ৩]
**স্পিকার নোটস (Speaker Notes):** [উপস্থাপকের জন্য পরামর্শ বা মৌখিক আলোচনার পয়েন্ট]
---`;
      }
      return `Build a professional, structured Presentation Slide Deck for:
- Title / Topic: ${data.presentationTitle}
- Slide Count: ${data.numSlides}
- Target Audience: ${data.targetAudience || 'Professional audience'}
- Core Points to Cover:
${data.keyPoints}

Format Rules:
Separate every slide with '---' horizontal rules and include:
---
### Slide [Number]: [Engaging Slide Title]
**Visual / Layout Suggestion:** [Icon, Diagram, or Layout advice]
**Key Content:**
- [High-impact bullet point 1]
- [High-impact bullet point 2]
- [High-impact bullet point 3]
**Speaker Notes:** [What the presenter should say in 2-3 sentences]
---`;
    },
  },
};

templates.meeting = templates.meetingNotes;
templates.content = templates.contentCreation;

export const PRODUCTIVITY_TEMPLATES = Object.freeze(templates);
