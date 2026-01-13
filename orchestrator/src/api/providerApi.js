import express from "express";
import { auth, db } from "../../firebase.js";

const router = express.Router();

async function verify(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = await auth.verifyIdToken(token);
    next();
  } catch (err) {
    console.error("VERIFY_ID_TOKEN_ERROR →", err);
    res.status(401).json({
      error: err.message,
      code: err.code,
    });
  }
}

/* -------- Provider Signup (already exists) -------- */
router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  const user = await auth.createUser({ email, password });

  await db.collection("providers").doc(user.uid).set({
    uid: user.uid,
    email,
    availabilityMinutes: 0,
    availabilityUpdatedAt: null,
    status: "REGISTERED",
    reliabilityScore: 1.0,
    createdAt: new Date(),
    lastSeen: null,
  });

  res.json({ providerId: user.uid });
});

/* -------- Set Availability & Accept -------- */
router.post("/availability", verify, async (req, res) => {
  const { availabilityMinutes } = req.body;

  if (!availabilityMinutes || availabilityMinutes <= 0) {
    return res.status(400).json({ error: "Invalid availability" });
  }

  const ref = db.collection("providers").doc(req.user.uid);

  await ref.update({
    availabilityMinutes,
    availabilityUpdatedAt: Date.now(),
    status: "READY",
  });

  res.json({ status: "READY" });
});

export default router;
