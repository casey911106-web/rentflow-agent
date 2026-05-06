/**
 * RentFlow Agent — Tailwind preset.
 * Mirrors the brand identity manual. Imported by web + mobile (NativeWind).
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        // Primary palette
        navy: {
          DEFAULT: '#082B5F',
          deep: '#061D3F',
        },
        teal: {
          DEFAULT: '#00A7A5',
          emerald: '#00B894',
          light: '#E6FAF8',
        },

        // Neutrals
        offwhite: '#F8FAFC',
        'gray-light': '#E5E7EB',
        'gray-medium': '#64748B',
        'gray-dark': '#334155',
        'near-black': '#0F172A',

        // Status
        success: '#00B894',
        warning: '#F59E0B',
        danger: '#DC2626',
        info: '#00A7A5',
        purple: '#7C3AED',

        // Shadcn semantic mapping
        primary: {
          DEFAULT: '#00A7A5',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#082B5F',
          foreground: '#FFFFFF',
        },
        background: '#F8FAFC',
        foreground: '#0F172A',
        card: '#FFFFFF',
        muted: {
          DEFAULT: '#F1F5F9',
          foreground: '#64748B',
        },
        border: '#E5E7EB',
        destructive: {
          DEFAULT: '#DC2626',
          foreground: '#FFFFFF',
        },
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
      },
      boxShadow: {
        card: '0 4px 16px rgba(15, 23, 42, 0.06)',
        modal: '0 20px 40px rgba(15, 23, 42, 0.16)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
};
