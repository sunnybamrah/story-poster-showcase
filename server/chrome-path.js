export function chromeExecutable(env = process.env, platform = process.platform) {
  return env.STORY_POSTER_CHROME || (platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/chromium');
}
