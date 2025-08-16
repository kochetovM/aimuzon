/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        background: '#FFFFFF',
        text: {
          primary: '#1D1D1F',
          secondary: '#6E6E73',
        },
        brand: {
          DEFAULT: '#0071E3', // primary accent / buttons
          hover: '#005BB5', // hover / active
          secondary: '#FF9500', // secondary accent
        },
        divider: '#E5E5EA', // divider / separators
      },
      boxShadow: {
        card: '0 4px 12px rgba(0,0,0,0.08)', // card shadow
      },
      backgroundImage: {
        'gradient-apple': 'linear-gradient(90deg, #0071E3 0%, #00C6FF 100%)',
      },
    },
  },
  plugins: [],
};
