import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDgf0U3y8A_ess_usjy-UTnoWcUvJ6t_3s",
  authDomain: "nurseryweb-77d95.firebaseapp.com",
  projectId: "nurseryweb-77d95",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export async function login(email, password) {
  const userCred = await signInWithEmailAndPassword(auth, email, password);
  return await userCred.user.getIdToken();
}
