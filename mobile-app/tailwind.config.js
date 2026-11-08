/**
 * Option A · Cupertino Daylight Glass tokens.
 * Every colour here maps 1:1 to mobile-app/src/constants/optionA.ts §2.1. Dark mode is
 * deliberately absent: the app is light-only (`userInterfaceStyle: "light"`).
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: '#F2F2F7',
        card: '#FFFFFF',
        fill: '#EFEFF4',
        separator: '#E5E5EA',
        drag: '#C7C7CC',
        ink: {
          DEFAULT: '#1C1C1E',
          soft: '#8E8E93',
        },
        system: {
          blue: '#007AFF',
          green: '#34C759',
          red: '#FF3B30',
        },
        status: {
          greenInk: '#248A3D',
          redInk: '#D70015',
        },
        diff: {
          add: '#E8F8EE',
          addInk: '#1E7E34',
          del: '#FDECEC',
          delInk: '#C82333',
        },
      },
      borderRadius: {
        card: '16px',
      },
    },
  },
  plugins: [],
};