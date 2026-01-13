import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync("firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "nurseryweb-77d95", // 🔥 REQUIRED FOR verifyIdToken
});

export const auth = admin.auth();
export const db = admin.firestore();
