import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAwZVmiypeiZEWPepxGbIGeJdZNjX1aez8",
  authDomain: "m2-r-24f40.firebaseapp.com",
  projectId: "m2-r-24f40",
  storageBucket: "m2-r-24f40.firebasestorage.app",
  messagingSenderId: "359762509592",
  appId: "1:359762509592:web:22a8332d31ac5af9dea86d",
  measurementId: "G-LYW762ZD10"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export { app, analytics };
