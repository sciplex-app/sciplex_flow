/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom color palette - warm, organic tones
        canvas: {
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
        accent: {
          50: '#ecfdf8',
          100: '#d1fae9',
          200: '#a7f3d6',
          300: '#6ee7bd',
          400: '#34d9a0',
          500: '#06E4A8',
          600: '#04c790',
          700: '#059f76',
          800: '#077d5f',
          900: '#06664e',
        },
        node: {
          data: '#3b82f6',      // Blue for data nodes
          transform: '#10b981', // Green for transform nodes
          visual: '#f59e0b',    // Amber for visual nodes
          ml: '#8b5cf6',        // Purple for ML nodes
          math: '#ef4444',      // Red for math nodes
          default: '#6b7280',   // Gray default
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'node': '0 4px 20px -2px rgba(0, 0, 0, 0.12), 0 2px 8px -2px rgba(0, 0, 0, 0.08)',
        'node-hover': '0 8px 30px -4px rgba(0, 0, 0, 0.16), 0 4px 12px -2px rgba(0, 0, 0, 0.1)',
        'node-selected': '0 0 0 2px rgba(6, 228, 168, 0.5), 0 8px 30px -4px rgba(0, 0, 0, 0.16)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}

