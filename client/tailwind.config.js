/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefdf3',
          100: '#d7f9e2',
          200: '#b2f0c8',
          300: '#7ee2a7',
          400: '#45cc80',
          500: '#20b062',
          600: '#148f4f',
          700: '#127242',
          800: '#125a37',
          900: '#104a2f',
        },
      },
    },
  },
  plugins: [],
};
