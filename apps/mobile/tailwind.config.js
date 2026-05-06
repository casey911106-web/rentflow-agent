/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#082B5F', deep: '#061D3F' },
        teal: { DEFAULT: '#00A7A5', emerald: '#00B894', light: '#E6FAF8' },
        offwhite: '#F8FAFC',
        'gray-light': '#E5E7EB',
        'gray-medium': '#64748B',
        'gray-dark': '#334155',
        'near-black': '#0F172A',
        success: '#00B894',
        warning: '#F59E0B',
        danger: '#DC2626',
      },
    },
  },
  plugins: [],
};
