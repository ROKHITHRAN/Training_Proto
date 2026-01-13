# provider/src/trainer/dataset.py
import torch

def generate_data(samples=1000):
    X = torch.randn(samples, 10)
    y = (X.sum(dim=1) > 0).float().unsqueeze(1)
    return X, y
