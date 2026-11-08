import konstaConfig from 'konsta/config';

/** @type {import('tailwindcss').Config} */
export default konstaConfig({
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F2F2F7',
        surface: '#FFFFFF',
        fill: '#EFEFF4',
        separator: '#E5E5EA',
        ink: '#1C1C1E',
        muted: '#8E8E93',
        iosblue: '#007AFF',
        iosgreen: '#34C759',
        iosred: '#FF3B30',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: ['SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
});
