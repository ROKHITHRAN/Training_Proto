import sys
import torch
import torch.nn as nn
import os

MODEL_DIR = sys.argv[1]
os.makedirs(MODEL_DIR, exist_ok=True)

class LogisticModel(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.linear = nn.Linear(input_dim, 1)

    def forward(self, x):
        return self.linear(x)

def init_model():
    model = LogisticModel(10)
    path = os.path.join(MODEL_DIR, "round-0.pt")
    torch.save(model.state_dict(), path)
    print("✅ Global model created:", path)

if __name__ == "__main__":
    init_model()
