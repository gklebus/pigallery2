import {MediaDTO, MediaDTOUtils} from './MediaDTO';
import {FileDTO} from './FileDTO';
import {PhotoDTO, PreviewPhotoDTO} from './PhotoDTO';
import {Utils} from '../Utils';

export interface DirectoryBaseDTO {
  name: string;
  path: string;
}

export interface DirectoryDTO<S extends FileDTO = MediaDTO> extends DirectoryBaseDTO {
  id: number;
  name: string;
  path: string;
  lastModified: number;
  lastScanned: number;
  isPartial?: boolean;
  parent: DirectoryDTO<S>;
  mediaCount: number;
  directories: DirectoryDTO<S>[];
  preview: PreviewPhotoDTO;
  media: S[];
  metaFile: FileDTO[];
}

export const DirectoryDTOUtils = {
  unpackDirectory: (dir: DirectoryDTO): void => {
    dir.media.forEach((media: MediaDTO) => {
      media.directory = dir;
    });

    if (dir.metaFile) {
      dir.metaFile.forEach((file: FileDTO) => {
        file.directory = dir;
      });
    }

    if (dir.directories) {
      dir.directories.forEach((directory: DirectoryDTO) => {
        DirectoryDTOUtils.unpackDirectory(directory);
        directory.parent = dir;
      });
    }
  },

  packDirectory: (dir: DirectoryDTO): DirectoryDTO => {
    if (dir.preview) {
      dir.preview.directory = {
        path: dir.preview.directory.path,
        name: dir.preview.directory.name,
      };

      // make sure that it is not a same object as one of the photo in the media[]
      // as the next foreach would remove the directory
      dir.preview = Utils.clone(dir.preview);
    }

    if (dir.media) {
      dir.media.forEach((media: MediaDTO) => {
        media.directory = null;
      });
    }

    if (dir.metaFile) {
      dir.metaFile.forEach((file: FileDTO) => {
        file.directory = null;
      });
    }
    if (dir.directories) {
      dir.directories.forEach((directory: DirectoryDTO) => {
        DirectoryDTOUtils.packDirectory(directory);
        directory.parent = null;
      });
    }

    return dir;

  },
  filterPhotos: (dir: DirectoryDTO): PhotoDTO[] => {
    return dir.media.filter(m => MediaDTOUtils.isPhoto(m)) as PhotoDTO[];
  },
  filterVideos: (dir: DirectoryDTO): PhotoDTO[] => {
    return dir.media.filter(m => MediaDTOUtils.isPhoto(m)) as PhotoDTO[];
  }
};
