import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "./global.css"
import App from './App'
import { ClerkProvider } from "@clerk/clerk-react";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

createRoot(document.getElementById('root')).render(
  <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <StrictMode>
    <App />
  </StrictMode>,
  </ClerkProvider>

)