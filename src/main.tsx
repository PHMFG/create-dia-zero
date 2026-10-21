import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './usability.css';
import './design-system.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
