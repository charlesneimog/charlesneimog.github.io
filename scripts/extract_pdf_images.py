from pdfminer.high_level import extract_pages
from pdfminer.layout import LTImage
import os

pdf_path = "/home/neimog/Downloads/NEIMOG2022-OrganizingJustIntonationPitchesthroughXenakisSievesandPrimeDecomposition.pdf"
output_folder = "article_images"
os.makedirs(output_folder, exist_ok=True)


from pdfminer.high_level import extract_pages
from pdfminer.layout import LTImage, LTFigure
import os


def save_images_from_figure(figure, output_folder, counter):
    for obj in figure:
        if isinstance(obj, LTImage):
            if obj.stream:
                image_bytes = obj.stream.get_rawdata()
                filename = os.path.join(output_folder, f"image_{counter[0]}.jpg")
                with open(filename, "wb") as f:
                    f.write(image_bytes)
                counter[0] += 1


os.makedirs(output_folder, exist_ok=True)
counter = [1]  # lista para usar como mutable integer

for page_layout in extract_pages(pdf_path):
    save_images_from_figure(page_layout, output_folder, counter)

print("Extração concluída!")
