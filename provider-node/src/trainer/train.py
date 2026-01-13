import sys
import torch
import torch.nn as nn
from model import LogisticModel
from dataset import generate_data

global_path = sys.argv[1]
output_path = sys.argv[2]

model = LogisticModel(10)
model.load_state_dict(torch.load(global_path))
model.train()

X, y = generate_data()

criterion = nn.BCEWithLogitsLoss()
optimizer = torch.optim.SGD(model.parameters(), lr=0.1)

optimizer.zero_grad()
out = model(X)
loss = criterion(out, y)
loss.backward()
optimizer.step()

torch.save(model.state_dict(), output_path)
print("Local training complete, loss:", loss.item())
