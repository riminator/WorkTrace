from setuptools import setup, find_packages

setup(
    name="knowledge-base",
    version="0.1.0",
    packages=find_packages(),
    install_requires=open("requirements.txt").read().splitlines(),
    entry_points={
        "console_scripts": [
            "kb=kb.cli:cli",
        ],
    },
    python_requires=">=3.10",
)
