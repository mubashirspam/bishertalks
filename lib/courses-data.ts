export type ContentType = 'video' | 'pdf';

export interface Lesson {
  slug: string;
  title: string;
  type: ContentType;
  url: string;
  duration?: string;
}

export interface Module {
  id: number;
  title: string;
  lessons: Lesson[];
}

export interface Course {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnail: string;
  modules: Module[];
}

export const courses: Course[] = [
  {
    slug: 'nlp',
    title: 'Neuro Linguistic Programming',
    subtitle: 'NLP Mastery Course',
    description:
      'Master the art of Neuro Linguistic Programming. Learn how to reprogram your mind, break limiting beliefs, and unlock your full potential through proven NLP techniques and practices.',
    thumbnail: '/images/courses/nlp-cover.jpg',
    modules: [
      {
        id: 0,
        title: 'Getting Started',
        lessons: [
          {
            slug: 'why-this-course',
            title: 'Why This Course?',
            type: 'video',
            url: '',
          },
          {
            slug: 'define-your-goal',
            title: 'Define Your Goal',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1s-DZ6iCm4NJsQS5oKmlDYxXs3nf7HveD/view?usp=share_link',
          },
        ],
      },
      {
        id: 1,
        title: 'Introduction to NLP',
        lessons: [
          {
            slug: 'plan-your-day',
            title: 'Plan Your Day',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/15wlybRhwpGBX3L3_xiTKC1rYErM6ckZY/view?usp=share_link',
          },
          {
            slug: 'what-is-nlp',
            title: 'What is NLP?',
            type: 'video',
            url: '',
          },
          {
            slug: 'how-nlp-works',
            title: 'How NLP Works?',
            type: 'video',
            url: 'https://youtu.be/RWkjloNI2tw',
          },
          {
            slug: 'principles-of-nlp',
            title: 'Principles of NLP',
            type: 'video',
            url: 'https://youtu.be/tcAopQeYK88',
          },
          {
            slug: 'module-1-notes',
            title: 'Module 1 Notes',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1aExXLEBtD8_1snAu5CnFFRUU4OboB5H7/view?usp=share_link',
          },
        ],
      },
      {
        id: 2,
        title: 'NLP Filters',
        lessons: [
          {
            slug: 'nlp-filters-1',
            title: 'NLP Filters - Part 1',
            type: 'video',
            url: 'https://youtu.be/vtlESS8v6vw',
          },
          {
            slug: 'nlp-filters-2',
            title: 'NLP Filters - Part 2',
            type: 'video',
            url: 'https://youtu.be/s2iHNuW06uI',
          },
          {
            slug: 'e-r-outcome',
            title: 'E + R = Outcome',
            type: 'video',
            url: 'https://youtu.be/TtX7xgYdjIM',
          },
        ],
      },
      {
        id: 3,
        title: 'Preferred Representational System',
        lessons: [
          {
            slug: 'prs-intro',
            title: 'Preferred Representational System',
            type: 'video',
            url: 'https://youtu.be/s2iHNuW06uI',
          },
          {
            slug: 'prs-pdf',
            title: 'PRS Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1DRMJp_0biRntu5JOH7WPlraRRR6clKoB/view?usp=share_link',
          },
          {
            slug: 'vakog',
            title: 'VAKOG',
            type: 'video',
            url: 'https://youtu.be/5bIQTUsol2c',
          },
          {
            slug: 'vakog-pdf',
            title: 'VAKOG Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1iRN7Nlw7OVgZ3kRyvxOf7t9m_rISk9B-/view?usp=share_link',
          },
          {
            slug: 'prs-2',
            title: 'Preferred Representational System - Part 2',
            type: 'video',
            url: 'https://youtu.be/iN8ii-5yIew',
          },
        ],
      },
      {
        id: 4,
        title: 'Mental Map & Internal Representation',
        lessons: [
          {
            slug: 'mental-map',
            title: 'Mental Map',
            type: 'video',
            url: 'https://youtu.be/HbwvhLCFIMQ',
          },
          {
            slug: 'map-is-not-the-territory',
            title: 'Map is Not the Territory',
            type: 'video',
            url: 'https://youtu.be/6sjc8J10IpU',
          },
          {
            slug: 'internal-representation',
            title: 'Internal Representation',
            type: 'video',
            url: 'https://youtu.be/Z8xfoTDwRB0',
          },
        ],
      },
      {
        id: 5,
        title: 'Modalities & Sub-Modalities',
        lessons: [
          {
            slug: 'modalities',
            title: 'Modalities',
            type: 'video',
            url: 'https://youtu.be/4doFG-2xNfk',
          },
          {
            slug: 'sub-modalities',
            title: 'Sub-Modalities',
            type: 'video',
            url: 'https://youtu.be/xEMX2ALF2zo',
          },
          {
            slug: 'sub-modalities-practices',
            title: 'Sub-Modalities Practices',
            type: 'video',
            url: 'https://youtu.be/Z_aoNz4rV0Q',
          },
        ],
      },
      {
        id: 6,
        title: 'Conditioning & Anchoring',
        lessons: [
          {
            slug: 'conditioning',
            title: 'Conditioning',
            type: 'video',
            url: 'https://youtu.be/yowzODRqe1U',
          },
          {
            slug: 'anchoring',
            title: 'Anchoring',
            type: 'video',
            url: 'https://youtu.be/-T1L5tgchw4',
          },
          {
            slug: 'eye-accessing-cue',
            title: 'Eye Accessing Cue',
            type: 'video',
            url: 'https://youtu.be/x0rb3BMv40Q',
          },
          {
            slug: 'eye-accessing-cue-pdf',
            title: 'Eye Accessing Cue Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1zvRrFVqxRpGo3P0W-e1iK-t2Lsszm8g2/view?usp=share_link',
          },
        ],
      },
      {
        id: 7,
        title: 'Outcome',
        lessons: [
          {
            slug: 'outcome-1',
            title: 'Outcome - Part 1',
            type: 'video',
            url: 'https://youtu.be/ENdwnkC8mDQ',
          },
          {
            slug: 'outcome-pdf-1',
            title: 'Outcome Worksheet 1',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1E0Gt5EPcsjGux3UCjCEPisiwJySD21iM/view?usp=share_link',
          },
          {
            slug: 'outcome-2',
            title: 'Outcome - Part 2',
            type: 'video',
            url: 'https://youtu.be/a-njxEynTqY',
          },
          {
            slug: 'outcome-pdf-2',
            title: 'Outcome Worksheet 2',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1ySZjofvrkiP16Ev8OgsoWU9kREnDoQXo/view?usp=share_link',
          },
          {
            slug: 'outcome-pdf-3',
            title: 'Outcome Worksheet 3',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/11iuby_MhUc8s8LEAkQ2KIHDBfX6CSO-M/view?usp=share_link',
          },
        ],
      },
      {
        id: 8,
        title: 'Belief System',
        lessons: [
          {
            slug: 'self-love-pdf',
            title: 'Self Love Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1reuOHCR4W_mwwr_1mRQ8Hxhmbk2KoyZ5/view?usp=share_link',
          },
          {
            slug: 'self-belief',
            title: 'Self Belief',
            type: 'video',
            url: 'https://youtu.be/_mal0_lfoQA',
          },
          {
            slug: 'belief-system-pdf',
            title: 'Belief System Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1MQe52uj1K0qWipIKuLl3VHjK-uOSG7ZV/view?usp=share_link',
          },
          {
            slug: 'limiting-belief',
            title: 'Limiting Belief',
            type: 'video',
            url: 'https://youtu.be/EAM3v7APQ9I',
          },
          {
            slug: 'limiting-belief-pdf',
            title: 'Limiting Belief Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1-KK4Gr9GWzAx9kg75w28o31aOkRixsQH/view?usp=share_link',
          },
          {
            slug: 'empowering-belief',
            title: 'Empowering Belief',
            type: 'video',
            url: 'https://youtu.be/mGxMNo69ers',
          },
          {
            slug: 'empowering-belief-pdf',
            title: 'Empowering Belief Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1U4hwg9iezsXWanIp3gUfvu08uDZEMnDz/view?usp=share_link',
          },
        ],
      },
      {
        id: 9,
        title: 'Reframe',
        lessons: [
          {
            slug: 'reframe-1',
            title: 'Reframe - Part 1',
            type: 'video',
            url: 'https://youtu.be/2_30C40oLVY',
          },
          {
            slug: 'reframe-2',
            title: 'Reframe - Part 2',
            type: 'video',
            url: 'https://youtu.be/9Ly-rAYw_68',
          },
          {
            slug: 'reframe-3',
            title: 'Reframe - Part 3',
            type: 'video',
            url: 'https://youtu.be/gjdlhN74GKs',
          },
          {
            slug: 'reframe-pdf',
            title: 'Reframe Notes',
            type: 'pdf',
            url: 'https://docs.google.com/document/d/1-VKG25yd094beRYHPvgbVBcvjKuzD9nS/edit?usp=share_link&ouid=101120288452301067414&rtpof=true&sd=true',
          },
          {
            slug: 'reframe-4',
            title: 'Reframe - Part 4',
            type: 'video',
            url: 'https://youtu.be/9O2jdO597OQ',
          },
          {
            slug: 'self-talk-pdf',
            title: 'Self Talk Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1H_mNywzNLyfWLglIoAZfPlwvwUvxe7zs/view?usp=share_link',
          },
        ],
      },
      {
        id: 10,
        title: 'Programming & Awareness',
        lessons: [
          {
            slug: 'programming',
            title: 'Programming',
            type: 'video',
            url: 'https://youtu.be/ZE4oS8nxM_Y',
          },
          {
            slug: 'awareness',
            title: 'Awareness',
            type: 'video',
            url: 'https://youtu.be/_ot4AdzKQbY',
          },
          {
            slug: 'mindfulness',
            title: 'Mindfulness',
            type: 'video',
            url: 'https://youtu.be/kWiiyMGpjx0',
          },
        ],
      },
      {
        id: 11,
        title: 'Purification & Gratitude',
        lessons: [
          {
            slug: 'purification',
            title: 'Purification',
            type: 'video',
            url: 'https://youtu.be/xzsd5oLIjW4',
          },
          {
            slug: 'forgiveness',
            title: 'Forgiveness',
            type: 'video',
            url: 'https://youtu.be/BGIJeyUVUdg',
          },
          {
            slug: 'gratitude',
            title: 'Gratitude',
            type: 'video',
            url: 'https://youtu.be/1X5DUukahd8',
          },
          {
            slug: 'attitude-of-gratitude',
            title: 'Attitude of Gratitude',
            type: 'video',
            url: 'https://youtu.be/uRpyXJXmsto',
          },
          {
            slug: 'problem-solving-pdf',
            title: 'Problem Solving Notes',
            type: 'pdf',
            url: 'https://docs.google.com/document/d/19V9YZm0BjQyFQ2XyS1h97mIdvthOzidK/edit?usp=share_link&ouid=101120288452301067414&rtpof=true&sd=true',
          },
        ],
      },
      {
        id: 12,
        title: 'Installation & Habits',
        lessons: [
          {
            slug: 'installation',
            title: 'Installation',
            type: 'video',
            url: 'https://youtu.be/bAt6FsT2QUA',
          },
          {
            slug: 'affirmation',
            title: 'Affirmation',
            type: 'video',
            url: 'https://youtu.be/0qiBw45POe4',
          },
          {
            slug: 'visualisation',
            title: 'Visualisation',
            type: 'video',
            url: 'https://youtu.be/6pbud-oy5AI',
          },
          {
            slug: 'habitualisation',
            title: 'Habitualisation',
            type: 'video',
            url: 'https://youtu.be/NGdg-b4TYx4',
          },
          {
            slug: 'habits-pdf',
            title: 'Habits Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/14dry4i4pdao0TXngO9fe8xiLMmG-h6It/view?usp=share_link',
          },
        ],
      },
      {
        id: 13,
        title: 'Modelling & Learning',
        lessons: [
          {
            slug: 'modelling-1',
            title: 'Modelling - Part 1',
            type: 'video',
            url: 'https://youtu.be/CkEnQwM2K2E',
          },
          {
            slug: 'modelling-2',
            title: 'Modelling - Part 2',
            type: 'video',
            url: 'https://youtu.be/PoWbjBkzPjA',
          },
          {
            slug: 'modelling-pdf',
            title: 'Modelling Worksheet',
            type: 'pdf',
            url: 'https://drive.google.com/file/d/1gLvNcMzhpDxxN_qUHcLpBc2LA4lWnUaZ/view?usp=share_link',
          },
          {
            slug: 'learning-steps',
            title: 'Learning Steps',
            type: 'video',
            url: 'https://youtu.be/OZalBWxOHV4',
          },
        ],
      },
    ],
  },
];

export function getCourse(slug: string): Course | undefined {
  return courses.find((c) => c.slug === slug);
}

export function getTotalLessons(course: Course): number {
  return course.modules.reduce((acc, m) => acc + m.lessons.length, 0);
}

export function getTotalVideos(course: Course): number {
  return course.modules.reduce(
    (acc, m) => acc + m.lessons.filter((l) => l.type === 'video').length,
    0
  );
}

export function getTotalPdfs(course: Course): number {
  return course.modules.reduce(
    (acc, m) => acc + m.lessons.filter((l) => l.type === 'pdf').length,
    0
  );
}
