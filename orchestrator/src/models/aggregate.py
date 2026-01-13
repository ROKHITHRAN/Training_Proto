import sys
import os
import torch

# Arguments from orchestrator
GLOBAL_MODEL_DIR = sys.argv[1]
PROVIDER_UPDATES_DIR = sys.argv[2]
ROUND = int(sys.argv[3])

prev_model_path = os.path.join(
    GLOBAL_MODEL_DIR, f"round-{ROUND - 1}.pt"
)
new_model_path = os.path.join(
    GLOBAL_MODEL_DIR, f"round-{ROUND}.pt"
)

# Collect provider updates for this round
update_files = [
    os.path.join(PROVIDER_UPDATES_DIR, f)
    for f in os.listdir(PROVIDER_UPDATES_DIR)
    if f.startswith(f"round-{ROUND}-") and f.endswith(".pt")
]

print(f"[AGG] Round {ROUND}: found {len(update_files)} updates")

# Load previous global model
global_weights = torch.load(prev_model_path)

# If no updates, just carry forward the model
if len(update_files) == 0:
    torch.save(global_weights, new_model_path)
    print("[AGG] No updates received. Carried forward previous model.")
    sys.exit(0)

# Initialize accumulator
avg_weights = {
    k: torch.zeros_like(v) for k, v in global_weights.items()
}

# Sum all provider updates
for update_path in update_files:
    local_weights = torch.load(update_path)
    for key in avg_weights:
        avg_weights[key] += local_weights[key]

# Average
num_updates = len(update_files)
for key in avg_weights:
    avg_weights[key] /= num_updates

# Save new global model
torch.save(avg_weights, new_model_path)
print(f"[AGG] New global model saved: round-{ROUND}.pt")
