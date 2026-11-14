"""Datas aproximadas para agregados com ano calendário e semana ISO."""
from datetime import date


def observation_week_start(year: int, month: int, iso_week: int) -> date:
    """Usa mês para desambiguar semana ISO na virada do ano.

    A fonte guarda ano calendário, não ano ISO. Janeiro/53 pertence ao ano
    ISO anterior; dezembro/1 pertence ao próximo. Preserva semanas 53 válidas.
    """
    if not 1 <= month <= 12 or not 1 <= iso_week <= 53:
        raise ValueError("Mês ou semana ISO inválidos")
    iso_year = year - 1 if month == 1 and iso_week >= 52 else year
    if month == 12 and iso_week == 1:
        iso_year = year + 1
    return date.fromisocalendar(iso_year, iso_week, 1)
