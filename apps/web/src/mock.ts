export type Language = 'en' | 'bn';
export interface DemoConfig {
  maxInputChars: number;
  maxMessages: number;
  chunkDelayMs: number;
}
export function validateDemoConfig(value: unknown): DemoConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid demo configuration.');
  const record = value as Record<string, unknown>;
  const bounds: Record<keyof DemoConfig, number> = {
    maxInputChars: 5000,
    maxMessages: 200,
    chunkDelayMs: 1000,
  };
  for (const [key, upper] of Object.entries(bounds)) {
    const field = record[key];
    if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 1 || field > upper)
      throw new Error('Invalid demo configuration.');
  }
  if (Object.keys(record).length !== Object.keys(bounds).length)
    throw new Error('Unexpected demo configuration.');
  if ((record.maxMessages as number) % 2 !== 0)
    throw new Error('Demo message limits must allow whole turns.');
  return {
    maxInputChars: record.maxInputChars as number,
    maxMessages: record.maxMessages as number,
    chunkDelayMs: record.chunkDelayMs as number,
  };
}

export const examples: Record<Language, readonly string[]> = {
  en: ['Summarize the demo notes', 'Translate the sample sentence', 'Help me plan a study session'],
  bn: ['ডেমো নোটের সারাংশ দাও', 'নমুনা বাক্যটি অনুবাদ করো', 'পড়াশোনার একটি পরিকল্পনা দাও'],
};
export function getReply(input: string, language: Language, config: DemoConfig): string {
  if (!input.trim() || input.length > config.maxInputChars)
    throw new Error('Enter a shorter synthetic demo message.');
  if (language !== 'en' && language !== 'bn') throw new Error('Invalid language.');
  if (/translate|অনুবাদ/i.test(input))
    return language === 'bn'
      ? 'নমুনা অনুবাদ\n\n“Learning starts with curiosity.”\n“কৌতূহল থেকেই শেখার শুরু।”\n\nএটি আগে থেকে লেখা একটি ডেমো উত্তর।'
      : 'Sample translation\n\n“Learning starts with curiosity.”\n“কৌতূহল থেকেই শেখার শুরু।”\n\nThis is a prewritten demo response.';
  if (/study|plan|পড়াশোনা|পরিকল্পনা/i.test(input))
    return language === 'bn'
      ? 'নমুনা পড়াশোনার পরিকল্পনা\n\n১. ১০ মিনিট আগের বিষয়গুলো ঝালিয়ে নাও।\n২. ২৫ মিনিট একটি নতুন বিষয় শেখো।\n৩. ৫ মিনিট বিরতি নাও।\n৪. নিজের ভাষায় একটি ছোট সারাংশ লেখো।\n\nএটি আগে থেকে লেখা একটি ডেমো উত্তর।'
      : 'A sample study session\n\n1. Review yesterday’s notes for 10 minutes.\n2. Focus on one new topic for 25 minutes.\n3. Take a five-minute break.\n4. Write a short explanation in your own words.\n\nThis is a prewritten demo response.';
  return language === 'bn'
    ? 'নমুনা সারাংশ\n\n• শেখার লক্ষ্যটি ছোট ও স্পষ্ট রাখো।\n• কাজকে সহজ কয়েকটি ধাপে ভাগ করো।\n• শেষে কী শিখলে তা নিজের ভাষায় লেখো।\n\nএই উত্তরটি ডেমোর জন্য আগে থেকে লেখা; আপনার বার্তার বিশ্লেষণ করা হয়নি।'
    : 'A little clarity, in three points\n\n• Start with one small, clear goal.\n• Break the work into a few manageable steps.\n• Finish by writing what you learned in your own words.\n\nThis is a prewritten sample; it does not analyze your message.';
}
