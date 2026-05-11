/** @type {import('tailwindcss').Config} */
export default {
  content: [
   "./app/**/*.{js,ts,jsx,tsx}",
  "./pages/**/*.{js,ts,jsx,tsx}",
  "./components/**/*.{js,ts,jsx,tsx}",
  "./src/**/*.{js,ts,jsx,tsx}", // Verifica si tus archivos están en /src
],
  theme: {
    extend: {},
  },
  plugins: [],
}
