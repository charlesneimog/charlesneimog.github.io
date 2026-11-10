import numpy as np
import matplotlib.pyplot as plt
from scipy.interpolate import interp1d

# Configurações iniciais
np.random.seed(42)
num_pontos = 4
passo_temporal = 4  # Step constante de 4 unidades

# Gera pontos temporais equidistantes
x = np.arange(0, num_pontos * passo_temporal, passo_temporal)
y = np.random.uniform(1, 100, num_pontos)  # Valores positivos para log

# Cria pontos densos para interpolação
x_denso = np.linspace(x.min(), x.max(), 500)

# Interpolação Linear
linear = interp1d(x, y, kind='linear')
y_linear = linear(x_denso)

# Interpolação Logarítmica
with np.errstate(divide='ignore'):
    log_interp = interp1d(x, np.log(y), kind='linear')
y_log = np.exp(log_interp(x_denso))

# Configuração do gráfico
plt.figure(figsize=(12, 6))

# Elementos do gráfico
plt.scatter(x, y, color='red', s=80, zorder=3, label='Pontos Originais')
plt.plot(x_denso, y_linear, 'b--', lw=2, label='Interpolação Linear')
plt.plot(x_denso, y_log, 'g-.', lw=2, label='Interpolação Logarítmica')

# Customização
plt.title('Interpolação com Espaçamento Temporal Constante', fontsize=14)
plt.xlabel('Tempo (unidades)', fontsize=12)
plt.ylabel('Valor (log scale)', fontsize=12)
plt.grid(True, linestyle='--', alpha=0.5)
plt.legend()
plt.yscale('log')

# Salva em SVG
plt.savefig('interpolacao_constante.svg', format='svg', bbox_inches='tight')
plt.close()
