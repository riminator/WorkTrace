"""
Sample data analysis script using pandas and matplotlib.
Demonstrates loading, cleaning, and summarising a sales dataset.
"""
import csv
import statistics
from collections import defaultdict
from datetime import datetime


def load_sales(filepath: str) -> list[dict]:
    """Load sales records from a CSV file."""
    records = []
    with open(filepath, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append({
                "date": datetime.strptime(row["date"], "%Y-%m-%d"),
                "product": row["product"],
                "region": row["region"],
                "units": int(row["units"]),
                "revenue": float(row["revenue"]),
            })
    return records


def summarise_by_region(records: list[dict]) -> dict:
    """Aggregate total revenue and units sold per region."""
    totals: dict = defaultdict(lambda: {"revenue": 0.0, "units": 0})
    for r in records:
        totals[r["region"]]["revenue"] += r["revenue"]
        totals[r["region"]]["units"] += r["units"]
    return dict(totals)


def top_products(records: list[dict], n: int = 5) -> list[tuple]:
    """Return the top-n products by total revenue."""
    product_revenue: dict = defaultdict(float)
    for r in records:
        product_revenue[r["product"]] += r["revenue"]
    return sorted(product_revenue.items(), key=lambda x: x[1], reverse=True)[:n]


def monthly_trend(records: list[dict]) -> dict:
    """Calculate total revenue per calendar month."""
    monthly: dict = defaultdict(float)
    for r in records:
        key = r["date"].strftime("%Y-%m")
        monthly[key] += r["revenue"]
    return dict(sorted(monthly.items()))


def print_report(records: list[dict]) -> None:
    print("=" * 50)
    print("SALES REPORT")
    print("=" * 50)

    by_region = summarise_by_region(records)
    print("\nRevenue by Region:")
    for region, stats in sorted(by_region.items()):
        print(f"  {region:<15} ${stats['revenue']:>10,.2f}  ({stats['units']} units)")

    print("\nTop 5 Products:")
    for i, (product, revenue) in enumerate(top_products(records), 1):
        print(f"  {i}. {product:<20} ${revenue:>10,.2f}")

    revenues = [r["revenue"] for r in records]
    print(f"\nRevenue stats:")
    print(f"  Total   : ${sum(revenues):>12,.2f}")
    print(f"  Average : ${statistics.mean(revenues):>12,.2f}")
    print(f"  Median  : ${statistics.median(revenues):>12,.2f}")
    print(f"  Std Dev : ${statistics.stdev(revenues):>12,.2f}")


if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "sales.csv"
    data = load_sales(path)
    print_report(data)
